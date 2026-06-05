/**
 * Shared HTTP plumbing for the real (network) {@link LlmProvider} drivers — OpenAI, Anthropic,
 * Gemini. Kept driver-agnostic so each provider only maps its own request/response shape:
 *
 *   • {@link FetchLike} — a minimal structural `fetch` so providers don't depend on DOM/undici
 *     types and tests can inject a fake transport (no network).
 *   • {@link readSseEvents} / {@link sseData} — a tiny Server-Sent-Events reader (every provider
 *     streams as SSE), tolerant of chunk boundaries that split an event mid-stream.
 *   • {@link StreamingLlmProvider} — a base that implements `complete()` by draining
 *     `completeStream()`, so each driver writes the streaming path once and the non-streaming
 *     contract ("concatenated deltas === complete().text") holds by construction.
 */
import type { ChatMessage, LlmCallOptions, LlmCompletion, LlmProvider, LlmStreamChunk } from "../providers";
import { estimateTokens } from "../ingestion/chunk";

/** Minimal request init a provider sends (always JSON over POST). */
export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** The subset of the `fetch` Response the providers actually use. `body` is async-iterable —
 *  Node's `fetch` Response body (a web `ReadableStream`) is, and tests yield `Uint8Array`s. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body: AsyncIterable<Uint8Array> | null;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

/** Bind the platform `fetch`, or fail loudly so a missing transport is never a silent no-op. */
export function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable; pass an explicit `fetch` to the LLM provider");
  }
  return (f as (...args: unknown[]) => unknown).bind(globalThis) as unknown as FetchLike;
}

/** A non-2xx LLM API response. Carries provider + status so the chat layer can log/translate it. */
export class LlmRequestError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${provider} request failed (HTTP ${status}): ${responseBody.slice(0, 500)}`);
    this.name = "LlmRequestError";
  }
}

/**
 * Yields raw SSE event blocks (the text between blank lines) from a byte stream, buffering across
 * chunk boundaries so an event split across two network frames is still emitted whole. `\r\n` is
 * normalized to `\n` so the blank-line delimiter (`\n\n`) is found regardless of line endings.
 */
export async function* readSseEvents(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      yield buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
    }
  }
  const tail = (buffer + decoder.decode()).replace(/\r\n/g, "\n").trim();
  if (tail.length > 0) yield tail;
}

/** Extracts the `data:` payload from one SSE event block (joining multi-line data per spec). */
export function sseData(eventBlock: string): string | null {
  const data = eventBlock
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /, ""));
  return data.length > 0 ? data.join("\n") : null;
}

/**
 * Parses one SSE event block's `data:` payload as JSON, or returns `null` for a frame that carries
 * no usable object — no `data:` line, the `[DONE]` sentinel, an empty/whitespace keep-alive payload,
 * or an unparseable fragment. The SSE spec requires a consumer to ignore data it can't parse; doing
 * the `JSON.parse` here (the single choke point every driver shares) means one stray keep-alive or
 * malformed frame is skipped rather than throwing and aborting the whole answer mid-stream. Callers
 * `continue` on `null`.
 */
export function parseSseJson<T>(eventBlock: string): T | null {
  const data = sseData(eventBlock);
  if (data == null) return null;
  const trimmed = data.trim();
  if (trimmed.length === 0 || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/** Token estimate used when an API response omits usage, so cost logging is never silently zero. */
export function estimateUsage(messages: ChatMessage[], text: string): LlmCompletion["usage"] {
  return {
    promptTokens: estimateTokens(messages.map((m) => m.content).join("\n")),
    completionTokens: estimateTokens(text),
  };
}

/**
 * Base for streaming HTTP drivers: subclasses implement {@link completeStream}; `complete()` is
 * derived from it so the two paths can't diverge (the {@link LlmProvider} contract requires the
 * concatenation of stream deltas to equal `complete().text`).
 */
export abstract class StreamingLlmProvider implements LlmProvider {
  abstract readonly name: string;
  abstract completeStream(
    messages: ChatMessage[],
    options?: LlmCallOptions,
  ): AsyncIterable<LlmStreamChunk>;

  async complete(messages: ChatMessage[], options?: LlmCallOptions): Promise<LlmCompletion> {
    let text = "";
    let usage: LlmCompletion["usage"] | undefined;
    for await (const chunk of this.completeStream(messages, options)) {
      if (chunk.delta != null) text += chunk.delta;
      if (chunk.usage != null) usage = chunk.usage;
    }
    return { text, usage: usage ?? estimateUsage(messages, text) };
  }
}
