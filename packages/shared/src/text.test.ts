import { normalizeText } from "./text";

describe("normalizeText", () => {
  it("converts decomposed (NFD) Vietnamese to the composed (NFC) form", () => {
    const composed = "trưởng".normalize("NFC");
    const decomposed = "trưởng".normalize("NFD");

    expect(decomposed).not.toBe(composed);
    expect(normalizeText(decomposed)).toBe(composed);
  });

  it("is idempotent and length-preserving on already-NFC text", () => {
    const input = "Định giá sản phẩm";
    const once = normalizeText(input);
    expect(once).toBe(input);
    expect(normalizeText(once)).toBe(once);
  });
});
