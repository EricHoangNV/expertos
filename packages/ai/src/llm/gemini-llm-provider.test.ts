import { GeminiLlmProvider } from "./gemini-llm-provider";
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
  { role: "assistant", content: "earlier reply" },
  { role: "user", content: "frage" },
];

const STREAM = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hallo"}]}}]}\n\n',
  'data: {"candidates":[{"content":{"parts":[{"text":" Welt"}]}}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2}}\n\n',
];

describe("GeminiLlmProvider", () => {
  it("streams candidate part text and reads cumulative usageMetadata", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new GeminiLlmProvider({ apiKey: "key", fetch });
    const frames = await drain(provider.completeStream(MESSAGES));
    expect(frames.filter((f) => f.delta != null).map((f) => f.delta)).toEqual(["Hallo", " Welt"]);
    expect(frames.at(-1)?.usage).toEqual({ promptTokens: 8, completionTokens: 2 });
  });

  it("maps roles (assistant→model), lifts systemInstruction, key in header not URL", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new GeminiLlmProvider({ apiKey: "secret-key", fetch });
    await drain(provider.completeStream(MESSAGES));
    expect(provider.name).toBe("gemini-1.5-flash");
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse",
    );
    expect(calls[0].url).not.toContain("secret-key");
    expect(calls[0].init.headers["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(calls[0].init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Stay grounded." }] });
    expect(body.contents).toEqual([
      { role: "model", parts: [{ text: "earlier reply" }] },
      { role: "user", parts: [{ text: "frage" }] },
    ]);
  });

  it("complete() reduces the stream to the full answer + usage", async () => {
    const { fetch } = recordingFetch(sseResponse(STREAM));
    const provider = new GeminiLlmProvider({ apiKey: "key", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Hallo Welt");
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 2 });
  });

  it("threads a per-call model (into the URL) + temperature override (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new GeminiLlmProvider({ apiKey: "key", model: "gemini-1.5-flash", fetch });
    await drain(provider.completeStream(MESSAGES, { temperature: 0.2, model: "gemini-1.5-pro" }));
    // Gemini carries the model in the path, so the override rebuilds the URL.
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse",
    );
    expect(JSON.parse(calls[0].init.body).generationConfig).toEqual({ temperature: 0.2 });
    expect(provider.name).toBe("gemini-1.5-flash");
  });

  it("omits generationConfig and uses the configured model when no override is given (M17.3)", async () => {
    const { fetch, calls } = recordingFetch(sseResponse(STREAM));
    const provider = new GeminiLlmProvider({ apiKey: "key", fetch });
    await drain(provider.completeStream(MESSAGES));
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse",
    );
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty("generationConfig");
  });

  it("does not abort the answer on an empty/keep-alive data frame mid-stream", async () => {
    const { fetch } = recordingFetch(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hallo"}]}}]}\n\n',
        "data:\n\n", // empty keep-alive frame — must be skipped, not throw
        'data: {"candidates":[{"content":{"parts":[{"text":" Welt"}]}}]}\n\n',
      ]),
    );
    const provider = new GeminiLlmProvider({ apiKey: "key", fetch });
    const result = await provider.complete(MESSAGES);
    expect(result.text).toBe("Hallo Welt");
  });

  it("throws LlmRequestError on a non-2xx response", async () => {
    const { fetch } = recordingFetch(errorResponse(400, "bad request"));
    const provider = new GeminiLlmProvider({ apiKey: "key", fetch });
    await expect(drain(provider.completeStream(MESSAGES))).rejects.toBeInstanceOf(LlmRequestError);
  });
});
