import { voiceQuerySchema } from "./voice";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("voiceQuerySchema", () => {
  it("applies defaults for language and topK", () => {
    const parsed = voiceQuerySchema.parse({ expertId: UUID, text: "how should I price?" });
    expect(parsed.language).toBe("en");
    expect(parsed.topK).toBe(3);
  });

  it("requires a uuid expertId", () => {
    expect(() => voiceQuerySchema.parse({ expertId: "expert-1", text: "q" })).toThrow();
  });

  it("trims text and rejects empty / over-long text", () => {
    expect(voiceQuerySchema.parse({ expertId: UUID, text: "  hi  " }).text).toBe("hi");
    expect(() => voiceQuerySchema.parse({ expertId: UUID, text: "   " })).toThrow();
    expect(() =>
      voiceQuerySchema.parse({ expertId: UUID, text: "x".repeat(2001) }),
    ).toThrow();
  });

  it("bounds topK and rejects unknown languages", () => {
    expect(() => voiceQuerySchema.parse({ expertId: UUID, text: "q", topK: 0 })).toThrow();
    expect(() => voiceQuerySchema.parse({ expertId: UUID, text: "q", topK: 11 })).toThrow();
    expect(() =>
      voiceQuerySchema.parse({ expertId: UUID, text: "q", language: "fr" }),
    ).toThrow();
  });

  it("NFC-normalizes the query text", () => {
    const decomposed = "Định giá".normalize("NFD");
    const parsed = voiceQuerySchema.parse({ expertId: UUID, text: ` ${decomposed} ` });
    expect(parsed.text).toBe("Định giá".normalize("NFC"));
  });
});
