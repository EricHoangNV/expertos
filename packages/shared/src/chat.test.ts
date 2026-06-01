import { chatRequestSchema } from "./chat";

describe("chatRequestSchema", () => {
  it("applies defaults and trims/normalizes the question", () => {
    const parsed = chatRequestSchema.parse({ text: "  how do I file taxes  " });
    expect(parsed).toEqual({
      text: "how do I file taxes",
      language: "en",
      topK: 8,
    });
  });

  it("NFC-normalizes Vietnamese diacritics in the question", () => {
    // Decomposed (NFD) "ế" should normalize to its composed (NFC) form.
    const decomposed = "thuế"; // thuê + combining acute
    const parsed = chatRequestSchema.parse({ text: decomposed });
    expect(parsed.text).toBe("thuế".normalize("NFC"));
    expect(parsed.text.normalize("NFC")).toBe(parsed.text);
  });

  it("accepts an existing conversation, expert, language, and topK", () => {
    const parsed = chatRequestSchema.parse({
      text: "follow up",
      conversationId: "11111111-1111-1111-1111-111111111111",
      expertId: "22222222-2222-2222-2222-222222222222",
      language: "vi",
      topK: 5,
    });
    expect(parsed.conversationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.expertId).toBe("22222222-2222-2222-2222-222222222222");
    expect(parsed.language).toBe("vi");
    expect(parsed.topK).toBe(5);
  });

  it("rejects empty text", () => {
    expect(chatRequestSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects a non-uuid conversationId", () => {
    expect(chatRequestSchema.safeParse({ text: "q", conversationId: "nope" }).success).toBe(false);
  });

  it("rejects an out-of-range topK", () => {
    expect(chatRequestSchema.safeParse({ text: "q", topK: 0 }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ text: "q", topK: 99 }).success).toBe(false);
  });
});
