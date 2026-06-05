/**
 * Google Gemini driver (`:streamGenerateContent?alt=sse`). Code-complete backup provider behind the
 * same {@link LlmProvider} contract. Gemini-specific mappings: the assistant role is `model`,
 * messages are `contents: [{ role, parts:[{text}] }]`, the system prompt is a top-level
 * `systemInstruction`, and usage is reported as cumulative `usageMetadata` on each SSE frame (last
 * one wins). The key is sent via the `x-goog-api-key` header (not the URL) so it can't leak in logs.
 */
import type { ChatMessage, LlmCallOptions, LlmStreamChunk } from "../providers";
import {
  StreamingLlmProvider,
  defaultFetch,
  estimateUsage,
  readSseEvents,
  parseSseJson,
  LlmRequestError,
  type FetchLike,
} from "./http";

export interface GeminiLlmConfig {
  apiKey: string;
  /** Model id; also {@link LlmProvider.name}. Default `gemini-1.5-flash`. */
  model?: string;
  /** Override for tests. Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string;
  fetch?: FetchLike;
}

interface GeminiFrame {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiLlmProvider extends StreamingLlmProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(config: GeminiLlmConfig) {
    super();
    if (!config.apiKey) throw new Error("GeminiLlmProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.name = config.model ?? "gemini-1.5-flash";
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    this.fetch = config.fetch ?? defaultFetch();
  }

  async *completeStream(
    messages: ChatMessage[],
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    // Gemini carries the model in the path, so a per-call model override rebuilds the URL.
    const model = options?.model ?? this.name;
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const res = await this.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents,
        ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(options?.temperature != null
          ? { generationConfig: { temperature: options.temperature } }
          : {}),
      }),
    });
    if (!res.ok || res.body == null) {
      throw new LlmRequestError("gemini", res.status, res.ok ? "empty response body" : await res.text());
    }

    let full = "";
    let usage: LlmStreamChunk["usage"];
    for await (const event of readSseEvents(res.body)) {
      const frame = parseSseJson<GeminiFrame>(event);
      if (frame == null) continue;
      const text = (frame.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      if (text.length > 0) {
        full += text;
        yield { delta: text };
      }
      if (frame.usageMetadata) {
        usage = {
          promptTokens: frame.usageMetadata.promptTokenCount ?? 0,
          completionTokens: frame.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
    }
    yield { usage: usage ?? estimateUsage(messages, full) };
  }
}
