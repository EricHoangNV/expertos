import { costMicrosFor } from "./model-pricing";

describe("costMicrosFor (Open Decision #4 unit-economics model)", () => {
  it("prices the standard answer model (echo-dev) per the $0.15/$0.60 tier", () => {
    // 15 micros/prompt-token, 60 micros/completion-token.
    expect(costMicrosFor("echo-dev", 1000, 1000)).toBe(1000 * 15 + 1000 * 60);
  });

  it("prices the premium tier ~20× the standard tier", () => {
    const standard = costMicrosFor("gpt-4o-mini", 3000, 600);
    const premium = costMicrosFor("gpt-4o", 3000, 600);
    expect(premium).toBeGreaterThan(standard * 15);
    // The modeled premium answer ≈ $0.018 = 1,800,000 micros (3000×300 + 600×1500).
    expect(premium).toBe(3000 * 300 + 600 * 1500);
  });

  it("prices the degraded mini model well below the premium model (the degrade margin win)", () => {
    const premium = costMicrosFor("gpt-4o", 3000, 600);
    const degraded = costMicrosFor("echo-dev-mini", 3000, 600);
    expect(degraded).toBeLessThan(premium / 15);
  });

  it("prices embeddings cheaply with zero completion cost", () => {
    expect(costMicrosFor("hashing-dev", 1000, 0)).toBe(1000 * 2);
    // Completion tokens never cost on an embedding model.
    expect(costMicrosFor("text-embedding-3-small", 0, 1000)).toBe(0);
  });

  it("defaults an unknown model to the standard tier (never silently free)", () => {
    expect(costMicrosFor("some-future-model", 100, 100)).toBe(
      costMicrosFor("echo-dev", 100, 100),
    );
    expect(costMicrosFor("some-future-model", 100, 100)).toBeGreaterThan(0);
  });

  it("defaults token counts to zero", () => {
    expect(costMicrosFor("echo-dev")).toBe(0);
  });
});
