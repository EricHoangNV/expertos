import { detectHighStakes } from "./detect";

describe("detectHighStakes", () => {
  it("returns null for an everyday, non-high-stakes question", () => {
    expect(detectHighStakes("What is a good morning routine?")).toBeNull();
    expect(detectHighStakes("")).toBeNull();
  });

  it("flags a financial question and reports the category + matched term", () => {
    const out = detectHighStakes("How should I invest my retirement savings?");
    expect(out).not.toBeNull();
    expect(out?.categories).toContain("financial");
    expect(out?.matchedTerms).toEqual(expect.arrayContaining(["invest", "retirement", "savings"]));
  });

  it("flags legal, medical, and tax questions", () => {
    expect(detectHighStakes("Should I sue my landlord?")?.categories).toEqual(["legal"]);
    expect(detectHighStakes("What medication should I take for these symptoms?")?.categories).toEqual([
      "medical",
    ]);
    expect(detectHighStakes("How do I lower my taxable income?")?.categories).toEqual(["tax"]);
  });

  it("reports multiple categories in declared order when several match", () => {
    const out = detectHighStakes("Are the legal fees and the lawsuit settlement taxable?");
    expect(out?.categories).toEqual(["legal", "tax"]);
  });

  it("matches whole words only — 'tax' does not fire on 'syntax'", () => {
    expect(detectHighStakes("How do I improve my syntax?")).toBeNull();
  });

  it("matches a multi-word term as a contiguous run", () => {
    expect(detectHighStakes("Can you explain capital gains to me?")?.categories).toEqual(["financial"]);
  });

  it("deduplicates repeated matched terms", () => {
    const out = detectHighStakes("tax tax tax season");
    expect(out?.matchedTerms).toEqual(["tax"]);
  });

  it("matches Vietnamese terms regardless of NFC/NFD encoding (OD#9, directive §36)", () => {
    // "đầu tư" (to invest) supplied decomposed (NFD) — must still match the NFC keyword list.
    const decomposed = "Tôi nên đầu tư vào đâu?".normalize("NFD");
    expect(detectHighStakes(decomposed)?.categories).toEqual(["financial"]);
    expect(detectHighStakes("Tôi cần luật sư cho hợp đồng này")?.categories).toEqual(["legal"]);
  });
});
