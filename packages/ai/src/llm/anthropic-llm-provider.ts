/**
 * Anthropic Messages API driver (`POST /v1/messages`, streaming). Code-complete backup provider
 * behind the same {@link LlmProvider} contract as OpenAI. Two shape differences from OpenAI are
 * handled here: (1) the system prompt is a top-level `system` field, not a message with role
 * `system`, so system turns are lifted out of `messages`; (2) usage arrives split across the
 * `message_start` (input tokens) and `message_delta` (output tokens) SSE events.
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

export interface AnthropicLlmConfig {
  apiKey: string;
  /** Model id; also {@link LlmProvider.name}. Default `claude-haiku-4-5`. */
  model?: string;
  /** Upper bound on generated tokens (Anthropic requires it). Default 1024. */
  maxTokens?: number;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: FetchLike;
}

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicLlmProvider extends StreamingLlmProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly maxTokens: number;
  private readonly apiVersion: string;
  private readonly fetch: FetchLike;

  constructor(config: AnthropicLlmConfig) {
    super();
    if (!config.apiKey) throw new Error("AnthropicLlmProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.name = config.model ?? "claude-haiku-4-5";
    this.maxTokens = config.maxTokens ?? 1024;
    this.apiVersion = config.apiVersion ?? "2023-06-01";
    const base = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
    this.url = `${base}/messages`;
    this.fetch = config.fetch ?? defaultFetch();
  }

  async *completeStream(
    messages: ChatMessage[],
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    const res = await this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify({
        model: options?.model ?? this.name,
        max_tokens: this.maxTokens,
        ...(system.length > 0 ? { system } : {}),
        ...(options?.temperature != null ? { temperature: options.temperature } : {}),
        messages: turns,
        stream: true,
      }),
    });
    if (!res.ok || res.body == null) {
      throw new LlmRequestError("anthropic", res.status, res.ok ? "empty response body" : await res.text());
    }

    let full = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let sawUsage = false;
    for await (const event of readSseEvents(res.body)) {
      const frame = parseSseJson<AnthropicEvent>(event);
      if (frame == null) continue;
      if (frame.type === "content_block_delta" && frame.delta?.type === "text_delta") {
        const text = frame.delta.text ?? "";
        if (text.length > 0) {
          full += text;
          yield { delta: text };
        }
      } else if (frame.type === "message_start" && frame.message?.usage) {
        promptTokens = frame.message.usage.input_tokens ?? promptTokens;
        completionTokens = frame.message.usage.output_tokens ?? completionTokens;
        sawUsage = true;
      } else if (frame.type === "message_delta" && frame.usage) {
        completionTokens = frame.usage.output_tokens ?? completionTokens;
        sawUsage = true;
      }
    }
    yield { usage: sawUsage ? { promptTokens, completionTokens } : estimateUsage(messages, full) };
  }
}
