import { cosineSimilarity } from "./similarity";

describe("cosineSimilarity", () => {
  it("returns 1 for identical direction", () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns -1 for opposite direction", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it("returns 0 when a vector is all zeros", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow("equal length");
  });
});
