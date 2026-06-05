import { OpenAiEmbeddingProvider } from "./openai-embedding-provider";
import { LlmRequestError, type FetchLike, type FetchRequestInit, type FetchResponseLike } from "../llm/http";

const DIM = 1536;
/** A deterministic 1536-dim vector whose first element encodes `seed` (so order is checkable). */
function vec(seed: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = seed;
  return v;
}

function jsonResponse(payload: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    body: null,
  };
}

function errorResponse(status: number, body: string): FetchResponseLike {
  return { ok: false, status, text: async () => body, body: null };
}

/** Returns a fetch that replays `responses` in call order and records each request. */
function scriptedFetch(responses: FetchResponseLike[]) {
  const calls: { url: string; init: FetchRequestInit }[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responses[Math.min(i++, responses.length - 1)];
  };
  return { fetch, calls };
}

describe("OpenAiEmbeddingProvider", () => {
  it("reports the model name and 1536 dimensions", () => {
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch: async () => jsonResponse({ data: [] }) });
    expect(provider.name).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(DIM);
  });

  it("sends model, input batch + dimensions and the auth header", async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse({ data: [{ index: 0, embedding: vec(1) }, { index: 1, embedding: vec(2) }] }),
    ]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    await provider.embed(["a", "b"]);
    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(calls[0].init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["a", "b"]);
    expect(body.dimensions).toBe(DIM);
  });

  it("restores input order when the API returns items out of order", async () => {
    const { fetch } = scriptedFetch([
      jsonResponse({
        data: [
          { index: 2, embedding: vec(30) },
          { index: 0, embedding: vec(10) },
          { index: 1, embedding: vec(20) },
        ],
      }),
    ]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    const out = await provider.embed(["x", "y", "z"]);
    expect(out.map((v) => v[0])).toEqual([10, 20, 30]);
  });

  it("batches inputs > 256 across multiple requests, preserving global order", async () => {
    const texts = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const { fetch, calls } = scriptedFetch([
      jsonResponse({ data: Array.from({ length: 256 }, (_, i) => ({ index: i, embedding: vec(i) })) }),
      jsonResponse({ data: Array.from({ length: 44 }, (_, i) => ({ index: i, embedding: vec(256 + i) })) }),
    ]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    const out = await provider.embed(texts);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].init.body).input).toHaveLength(256);
    expect(JSON.parse(calls[1].init.body).input).toHaveLength(44);
    expect(out).toHaveLength(300);
    expect(out[0][0]).toBe(0);
    expect(out[255][0]).toBe(255);
    expect(out[299][0]).toBe(299);
  });

  it("returns an empty array (and makes no request) for empty input", async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse({ data: [] })]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    expect(await provider.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws LlmRequestError on a non-2xx response", async () => {
    const { fetch } = scriptedFetch([errorResponse(429, "rate limit exceeded")]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    await expect(provider.embed(["a"])).rejects.toBeInstanceOf(LlmRequestError);
  });

  it("throws when the response count does not match the request", async () => {
    const { fetch } = scriptedFetch([jsonResponse({ data: [{ index: 0, embedding: vec(1) }] })]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    await expect(provider.embed(["a", "b"])).rejects.toThrow(/expected 2 embeddings/);
  });

  it("throws on a wrong-dimension vector", async () => {
    const { fetch } = scriptedFetch([jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] })]);
    const provider = new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetch });
    await expect(provider.embed(["a"])).rejects.toThrow(/dims, expected 1536/);
  });

  it("rejects construction without an apiKey", () => {
    expect(() => new OpenAiEmbeddingProvider({ apiKey: "" })).toThrow(/apiKey/);
  });
});
