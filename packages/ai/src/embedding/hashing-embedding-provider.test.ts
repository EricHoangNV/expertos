import { HashingEmbeddingProvider } from "./hashing-embedding-provider";
import { cosineSimilarity } from "../similarity";

describe("HashingEmbeddingProvider", () => {
  it("exposes name and default dimensions", () => {
    const provider = new HashingEmbeddingProvider();
    expect(provider.name).toBe("hashing-dev");
    expect(provider.dimensions).toBe(1536);
  });

  it("rejects non-positive / non-integer dimensions", () => {
    expect(() => new HashingEmbeddingProvider(0)).toThrow("positive integer");
    expect(() => new HashingEmbeddingProvider(-3)).toThrow("positive integer");
    expect(() => new HashingEmbeddingProvider(1.5)).toThrow("positive integer");
  });

  it("produces one vector of the configured dimension per input", async () => {
    const provider = new HashingEmbeddingProvider(64);
    const [v] = await provider.embed(["hello world"]);
    expect(v).toHaveLength(64);
  });

  it("is deterministic for identical text", async () => {
    const provider = new HashingEmbeddingProvider(64);
    const [a] = await provider.embed(["the expert says hello"]);
    const [b] = await provider.embed(["the expert says hello"]);
    expect(a).toEqual(b);
  });

  it("L2-normalizes non-empty vectors to unit length", async () => {
    const provider = new HashingEmbeddingProvider(128);
    const [v] = await provider.embed(["alpha beta gamma delta"]);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it("returns a zero vector for token-free text", async () => {
    const provider = new HashingEmbeddingProvider(32);
    const [v] = await provider.embed(["   !!!   "]);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("scores similar text higher than unrelated text", async () => {
    const provider = new HashingEmbeddingProvider(512);
    const [base, near, far] = await provider.embed([
      "tax deductions for small business owners",
      "small business owners and their tax deductions",
      "the weather today is sunny and warm",
    ]);
    expect(cosineSimilarity(base, near)).toBeGreaterThan(cosineSimilarity(base, far));
  });

  it("tokenizes Vietnamese diacritics as letters", async () => {
    const provider = new HashingEmbeddingProvider(256);
    const [v] = await provider.embed(["thuế doanh nghiệp nhỏ"]);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it("embeds multiple texts in one batch", async () => {
    const provider = new HashingEmbeddingProvider(16);
    const vectors = await provider.embed(["one", "two", "three"]);
    expect(vectors).toHaveLength(3);
  });
});
