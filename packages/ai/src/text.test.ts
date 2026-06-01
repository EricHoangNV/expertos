import { normalizeText, tokenize } from "./text";

describe("normalizeText", () => {
  it("canonicalizes NFD Vietnamese to NFC so the bytes match the composed form", () => {
    const composed = "Việt Nam".normalize("NFC");
    const decomposed = "Việt Nam".normalize("NFD");

    expect(decomposed).not.toBe(composed); // precondition: the two forms differ byte-for-byte
    expect(normalizeText(decomposed)).toBe(composed);
    expect(normalizeText(composed)).toBe(composed); // idempotent on already-NFC text
  });

  it("leaves plain ASCII untouched", () => {
    expect(normalizeText("hello world")).toBe("hello world");
  });
});

describe("tokenize", () => {
  it("keeps Vietnamese words whole regardless of normalization form", () => {
    const expected = ["việt", "nam", "tăng", "trưởng"];
    expect(tokenize("Việt Nam tăng trưởng".normalize("NFC"))).toEqual(expected);
    // The defect being guarded: decomposed marks fall outside [\p{L}\p{N}] and shatter the
    // words ("việt" -> "vie","t") unless NFC normalization runs first.
    expect(tokenize("Việt Nam tăng trưởng".normalize("NFD"))).toEqual(expected);
  });

  it("lowercases, splits on punctuation/whitespace, and keeps digits", () => {
    expect(tokenize("SaaS pricing: $99/month, 2 tiers")).toEqual([
      "saas",
      "pricing",
      "99",
      "month",
      "2",
      "tiers",
    ]);
  });

  it("returns an empty array for token-free text", () => {
    expect(tokenize("   …—  ")).toEqual([]);
  });
});
