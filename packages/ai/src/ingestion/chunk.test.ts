import { chunkText, estimateTokens } from "./chunk";

describe("estimateTokens", () => {
  it("returns 0 for empty / whitespace text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n\t ")).toBe(0);
  });

  it("scales with word count", () => {
    // 3 words / 0.75 = 4
    expect(estimateTokens("one two three")).toBe(4);
  });
});

describe("chunkText", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("keeps a short document in a single chunk", () => {
    const chunks = chunkText("hello world from the expert");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0, content: "hello world from the expert" });
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("normalizes internal whitespace and newlines to single spaces", () => {
    const chunks = chunkText("alpha\n\n  beta\tgamma");
    expect(chunks[0].content).toBe("alpha beta gamma");
  });

  it("splits long text into overlapping windows with sequential indexes", () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    // maxTokens 8 → 6 words/window; overlap 4 tokens → 3 words → step 3.
    const chunks = chunkText(words, { maxTokens: 8, overlapTokens: 4 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));

    // Overlap: the tail of chunk 0 reappears at the head of chunk 1.
    const firstWords = chunks[0].content.split(" ");
    const secondWords = chunks[1].content.split(" ");
    expect(secondWords[0]).toBe(firstWords[3]);
  });

  it("covers every word across the chunk set", () => {
    const words = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const chunks = chunkText(words.join(" "), { maxTokens: 6, overlapTokens: 1 });
    const seen = new Set(chunks.flatMap((c) => c.content.split(" ")));
    for (const w of words) {
      expect(seen.has(w)).toBe(true);
    }
  });

  it("hard-splits a single oversized run with no overlap", () => {
    const words = Array.from({ length: 10 }, (_, i) => `x${i}`).join(" ");
    const chunks = chunkText(words, { maxTokens: 4, overlapTokens: 0 });
    // 4 tokens → 3 words/window, step 3 → ceil(10/3) = 4 chunks
    expect(chunks).toHaveLength(4);
    expect(chunks[0].content).toBe("x0 x1 x2");
  });

  it("rejects a non-positive maxTokens", () => {
    expect(() => chunkText("a b c", { maxTokens: 0 })).toThrow("maxTokens must be positive");
  });

  it("rejects overlap >= maxTokens", () => {
    expect(() => chunkText("a b c", { maxTokens: 5, overlapTokens: 5 })).toThrow(
      "overlapTokens must be >= 0 and < maxTokens",
    );
    expect(() => chunkText("a b c", { maxTokens: 5, overlapTokens: -1 })).toThrow(
      "overlapTokens must be >= 0 and < maxTokens",
    );
  });
});
