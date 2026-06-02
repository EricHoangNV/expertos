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

  it("prices the real chat-provider default models (each is a modeled key, not the unknown fallback)", () => {
    // The factory's per-provider default model ids (ingestion.defaults.ts) must all be modeled so
    // usage logs get a real cost_micros rather than the unknown-model fallback.
    expect(costMicrosFor("gpt-4o-mini", 1000, 1000)).toBe(costMicrosFor("echo-dev", 1000, 1000));
    expect(costMicrosFor("claude-haiku-4-5", 1000, 1000)).toBe(costMicrosFor("echo-dev", 1000, 1000));
    expect(costMicrosFor("gemini-1.5-flash", 1000, 1000)).toBe(costMicrosFor("echo-dev", 1000, 1000));
    // The premium Gemini tier is priced ~20× the flash tier, mirroring the other providers.
    expect(costMicrosFor("gemini-1.5-pro", 3000, 600)).toBe(costMicrosFor("gpt-4o", 3000, 600));
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
