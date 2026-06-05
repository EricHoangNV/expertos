/**
 * OpenAI chat-completions driver (the production counterpart of {@link EchoLlmProvider}). Streams
 * answers from `POST /v1/chat/completions` with `stream_options.include_usage` so the terminal SSE
 * frame carries real token usage for cost logging. Roles map 1:1 (system/user/assistant), so the
 * grounded prompt the answer-builder emits is sent verbatim. Network/key handling lives in the
 * factory ({@link createDefaultLlmProvider}); this class is pure given an injected `fetch`.
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

export interface OpenAiLlmConfig {
  apiKey: string;
  /** Model id; also reported as {@link LlmProvider.name} for usage/pricing. Default `gpt-4o-mini`. */
  model?: string;
  /** Override for tests / Azure / proxies. Default `https://api.openai.com/v1`. */
  baseUrl?: string;
  fetch?: FetchLike;
}

interface OpenAiStreamFrame {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export class OpenAiLlmProvider extends StreamingLlmProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetch: FetchLike;

  constructor(config: OpenAiLlmConfig) {
    super();
    if (!config.apiKey) throw new Error("OpenAiLlmProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.name = config.model ?? "gpt-4o-mini";
    const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.url = `${base}/chat/completions`;
    this.fetch = config.fetch ?? defaultFetch();
  }

  async *completeStream(
    messages: ChatMessage[],
    options?: LlmCallOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model ?? this.name,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        stream_options: { include_usage: true },
        ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      }),
    });
    if (!res.ok || res.body == null) {
      throw new LlmRequestError("openai", res.status, res.ok ? "empty response body" : await res.text());
    }

    let full = "";
    let usage: LlmStreamChunk["usage"];
    for await (const event of readSseEvents(res.body)) {
      const frame = parseSseJson<OpenAiStreamFrame>(event);
      if (frame == null) continue;
      const delta = frame.choices?.[0]?.delta?.content;
      if (delta != null && delta.length > 0) {
        full += delta;
        yield { delta };
      }
      if (frame.usage != null) {
        usage = {
          promptTokens: frame.usage.prompt_tokens ?? 0,
          completionTokens: frame.usage.completion_tokens ?? 0,
        };
      }
    }
    yield { usage: usage ?? estimateUsage(messages, full) };
  }
}
