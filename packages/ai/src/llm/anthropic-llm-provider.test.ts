import { AnthropicLlmProvider } from "./anthropic-llm-provider";
import { LlmRequestError, type FetchLike, type FetchRequestInit, type FetchResponseLike } from "./http";
import type { ChatMessage, LlmStreamChunk } from "../providers";

function sseResponse(chunks: string[], status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => chunks.join(""),
    body: (async function* () {
      const enc = new TextEncoder();
      for (const c of chunks) yield enc.encode(c);
    })(),
  };
}

function errorResponse(status: number, body: string): FetchResponseLike {
  return { ok: false, status, text: async () => body, body: null };
}

function recordingFetch(response: FetchResponseLike) {
  const calls: { url: string; init: FetchRequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { fetch, calls };
}

async function drain(stream: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
  const out: LlmStreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "Stay grounded." },
  { role: "user", content: "first" },
  { role: "assistant", content: "earlier reply" },
  { role: "user", content: "lãnh đạo là gì" },
];

const STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Xin "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chào"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
];

describe("AnthropicLlmProvider", () => {
  it("streams text_delta events and merges split usage (message_start + message_delta)", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    const frames = await drain(provider.completeStream(MESSAGES));
    expect(frames.filter((f) => f.delta != null).map((f) => f.delta)).toEqual(["Xin ", "chào"]);
    expect(frames.at(-1)?.usage).toEqual({ promptTokens: 20, completionTokens: 5 });
  });

  it("lifts system out of messages and maps assistant/user roles", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", model: "claude-sonnet-4-6", fetch });
    await drain(provider.completeStream(MESSAGES));
    expect(provider.name).toBe("claude-sonnet-4-6");
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe("key");
    expect(calls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(calls[0].init.body);
    expect(body.system).toBe("Stay grounded.");
    expect(body.max_tokens).toBe(1024);
    expect(body.stream).toBe(true);
    // No role:"system" leaks into messages; assistant role is preserved.
    expect(body.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "earlier reply" },
      { role: "user", content: "lãnh đạo là gì" },
    ]);
  });

  it("complete() reduces the stream to the full answer + usage", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Xin chào");
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 5 });
  });

  it("threads a per-call temperature + model override into the request body (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", model: "claude-haiku-4-5", fetch });
    await drain(provider.completeStream(MESSAGES, { temperature: 0.1, model: "claude-sonnet-4-6" }));
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.temperature).toBe(0.1);
    expect(provider.name).toBe("claude-haiku-4-5");
  });

  it("omits temperature when no override is given (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    await drain(provider.completeStream(MESSAGES));
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty("temperature");
  });

  it("omits the system field when there is no system message", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    await drain(provider.completeStream([{ role: "user", content: "hi" }]));
    expect(JSON.parse(calls[0].init.body).system).toBeUndefined();
  });

  it("does not abort the answer on an empty/keep-alive data frame mid-stream", async () => {
    const { fetch } = recordingFetch(
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Xin "}}\n\n',
        "data:\n\n", // empty keep-alive frame — must be skipped, not throw
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chào"}}\n\n',
      ]),
    );
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Xin chào");
  });

  it("throws LlmRequestError on a non-2xx response", async () => {
    const { fetch } = recordingFetch(errorResponse(500, "overloaded"));
    const provider = new AnthropicLlmProvider({ apiKey: "key", fetch });
    await expect(drain(provider.completeStream(MESSAGES))).rejects.toBeInstanceOf(LlmRequestError);
  });
});
