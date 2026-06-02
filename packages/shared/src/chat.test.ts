import {
  chatRequestSchema,
  conversationListQuerySchema,
  conversationRenameSchema,
  conversationSearchQuerySchema,
  savedAnswerCreateSchema,
  savedAnswerListQuerySchema,
  answerFeedbackSubmitSchema,
  HIGH_STAKES_DISCLAIMER,
  HIGH_STAKES_DISCLAIMERS,
} from "./chat";
import { LANGUAGES } from "./ingestion";

describe("HIGH_STAKES_DISCLAIMERS (M13.4)", () => {
  it("provides a non-empty disclaimer for every supported locale", () => {
    for (const locale of LANGUAGES) {
      expect(typeof HIGH_STAKES_DISCLAIMERS[locale]).toBe("string");
      expect(HIGH_STAKES_DISCLAIMERS[locale].length).toBeGreaterThan(0);
    }
  });

  it("keeps the EN alias pointing at the canonical English entry (no drift)", () => {
    expect(HIGH_STAKES_DISCLAIMER).toBe(HIGH_STAKES_DISCLAIMERS.en);
  });

  it("localizes the copy — EN and VI differ", () => {
    expect(HIGH_STAKES_DISCLAIMERS.en).not.toBe(HIGH_STAKES_DISCLAIMERS.vi);
  });
});

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

describe("conversationListQuerySchema", () => {
  it("applies pagination defaults", () => {
    expect(conversationListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("coerces string query params from the URL", () => {
    expect(conversationListQuerySchema.parse({ limit: "5", offset: "10" })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it("rejects an out-of-range limit or negative offset", () => {
    expect(conversationListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("conversationRenameSchema", () => {
  it("trims the title", () => {
    expect(conversationRenameSchema.parse({ title: "  My taxes  " })).toEqual({
      title: "My taxes",
    });
  });

  it("rejects an empty or over-long title", () => {
    expect(conversationRenameSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(conversationRenameSchema.safeParse({ title: "x".repeat(101) }).success).toBe(false);
  });
});

describe("conversationSearchQuerySchema", () => {
  it("trims, normalizes the query, and applies pagination defaults", () => {
    expect(conversationSearchQuerySchema.parse({ q: "  taxes  " })).toEqual({
      q: "taxes",
      limit: 20,
      offset: 0,
    });
  });

  it("NFC-normalizes a Vietnamese query so it matches NFC-stored content", () => {
    const decomposed = "thuế"; // NFD: thuê + combining acute
    const parsed = conversationSearchQuerySchema.parse({ q: decomposed });
    expect(parsed.q).toBe("thuế".normalize("NFC"));
    expect(parsed.q.normalize("NFC")).toBe(parsed.q);
  });

  it("coerces string pagination params and rejects out-of-range values", () => {
    expect(conversationSearchQuerySchema.parse({ q: "x", limit: "5", offset: "2" })).toEqual({
      q: "x",
      limit: 5,
      offset: 2,
    });
    expect(conversationSearchQuerySchema.safeParse({ q: "x", limit: 0 }).success).toBe(false);
    expect(conversationSearchQuerySchema.safeParse({ q: "x", offset: -1 }).success).toBe(false);
  });

  it("rejects an empty or over-long query", () => {
    expect(conversationSearchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(conversationSearchQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("savedAnswerCreateSchema", () => {
  it("accepts a messageId with an optional trimmed note", () => {
    const parsed = savedAnswerCreateSchema.parse({
      messageId: "11111111-1111-1111-1111-111111111111",
      note: "  useful  ",
    });
    expect(parsed.note).toBe("useful");
  });

  it("accepts a messageId without a note", () => {
    const parsed = savedAnswerCreateSchema.parse({
      messageId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed.note).toBeUndefined();
  });

  it("rejects a non-uuid messageId or an over-long note", () => {
    expect(savedAnswerCreateSchema.safeParse({ messageId: "nope" }).success).toBe(false);
    expect(
      savedAnswerCreateSchema.safeParse({
        messageId: "11111111-1111-1111-1111-111111111111",
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("savedAnswerListQuerySchema", () => {
  it("applies pagination defaults and coerces params", () => {
    expect(savedAnswerListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(savedAnswerListQuerySchema.parse({ limit: "3" })).toEqual({ limit: 3, offset: 0 });
  });
});

describe("answerFeedbackSubmitSchema", () => {
  const MID = "11111111-1111-1111-1111-111111111111";

  it("accepts a 👍/👎 verdict with an optional trimmed reason", () => {
    expect(answerFeedbackSubmitSchema.parse({ messageId: MID, helpful: true })).toEqual({
      messageId: MID,
      helpful: true,
    });
    const parsed = answerFeedbackSubmitSchema.parse({
      messageId: MID,
      helpful: false,
      reason: "  too vague  ",
    });
    expect(parsed.reason).toBe("too vague");
  });

  it("rejects a non-uuid messageId, a missing/non-boolean verdict, or an over-long reason", () => {
    expect(answerFeedbackSubmitSchema.safeParse({ messageId: "nope", helpful: true }).success).toBe(
      false,
    );
    expect(answerFeedbackSubmitSchema.safeParse({ messageId: MID }).success).toBe(false);
    expect(
      answerFeedbackSubmitSchema.safeParse({ messageId: MID, helpful: "yes" }).success,
    ).toBe(false);
    expect(
      answerFeedbackSubmitSchema.safeParse({ messageId: MID, helpful: true, reason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});
