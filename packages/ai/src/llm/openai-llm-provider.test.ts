import { OpenAiLlmProvider } from "./openai-llm-provider";
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

/** Records the request so mapping (model/messages/headers) can be asserted, returns `response`. */
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
  { role: "system", content: "You are grounded." },
  { role: "user", content: "SOURCES\n[1] fact\nQUESTION:\nhi" },
];

const STREAM = [
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
  'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
  "data: [DONE]\n\n",
];

describe("OpenAiLlmProvider", () => {
  it("streams deltas and the terminal usage frame", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", fetch });
    const frames = await drain(provider.completeStream(MESSAGES));
    expect(frames.filter((f) => f.delta != null).map((f) => f.delta)).toEqual(["Hello", " world"]);
    expect(frames.at(-1)?.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });

  it("complete() concatenates deltas into the full answer", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });

  it("sends model, 1:1 role mapping, streaming + usage opts, and auth header", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", model: "gpt-4o", fetch });
    await drain(provider.completeStream(MESSAGES));
    expect(provider.name).toBe("gpt-4o");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages).toEqual([
      { role: "system", content: "You are grounded." },
      { role: "user", content: "SOURCES\n[1] fact\nQUESTION:\nhi" },
    ]);
  });

  it("threads a per-call temperature + model override into the request body (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetch });
    await drain(provider.completeStream(MESSAGES, { temperature: 0.15, model: "gpt-4o" }));
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.temperature).toBe(0.15);
    // The provider's reported name is unchanged by a per-call override (the chat layer logs the
    // effective model from the options, not from `provider.name`).
    expect(provider.name).toBe("gpt-4o-mini");
  });

  it("omits temperature when no override is given, keeping the provider default (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetch });
    await drain(provider.completeStream(MESSAGES));
    const body = JSON.parse(calls[0].init.body);
    expect(body).not.toHaveProperty("temperature");
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("estimates usage when the API omits a usage frame", async () => {
    const { fetch } = recordingFetch(
      sseResponse(['data: {"choices":[{"delta":{"content":"hi there"}}]}\n\n', "data: [DONE]\n\n"]),
    );
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", fetch });
    const frames = await drain(provider.completeStream(MESSAGES));
    const usage = frames.at(-1)?.usage;
    expect(usage?.promptTokens).toBeGreaterThan(0);
    expect(usage?.completionTokens).toBeGreaterThan(0);
  });

  it("does not abort the answer on an empty/keep-alive data frame mid-stream", async () => {
    const { fetch } = recordingFetch(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        "data:\n\n", // empty keep-alive frame a proxy can inject — must be skipped, not throw
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Hello world");
  });

  it("throws LlmRequestError on a non-2xx response", async () => {
    const { fetch } = recordingFetch(errorResponse(429, "rate limit exceeded"));
    const provider = new OpenAiLlmProvider({ apiKey: "sk-test", fetch });
    await expect(drain(provider.completeStream(MESSAGES))).rejects.toBeInstanceOf(LlmRequestError);
  });

  it("rejects construction without an apiKey", () => {
    expect(() => new OpenAiLlmProvider({ apiKey: "" })).toThrow(/apiKey/);
  });
});
