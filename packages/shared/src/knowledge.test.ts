import {
  knowledgeDraftCreateSchema,
  knowledgeDraftListQuerySchema,
  knowledgeDraftUpdateSchema,
  knowledgeListQuerySchema,
} from "./knowledge";

describe("knowledgeListQuerySchema", () => {
  it("defaults limit to 50 when omitted", () => {
    const parsed = knowledgeListQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.status).toBeUndefined();
    expect(parsed.scope).toBeUndefined();
  });

  it("coerces a numeric-string limit and keeps status/scope filters", () => {
    const parsed = knowledgeListQuerySchema.parse({
      status: "expert_review",
      scope: "global_expert",
      limit: "25",
    });
    expect(parsed).toEqual({
      status: "expert_review",
      scope: "global_expert",
      limit: 25,
    });
  });

  it("rejects a limit above the cap", () => {
    expect(() => knowledgeListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => knowledgeListQuerySchema.parse({ status: "retired" })).toThrow();
  });
});

describe("knowledgeDraftCreateSchema", () => {
  it("trims fields, defaults language, and omits an absent conversationId", () => {
    const parsed = knowledgeDraftCreateSchema.parse({
      title: "  Pricing FAQ  ",
      content: "  The standard plan is $20/mo.  ",
    });
    expect(parsed).toEqual({
      title: "Pricing FAQ",
      content: "The standard plan is $20/mo.",
      language: "en",
    });
    expect(parsed.conversationId).toBeUndefined();
  });

  it("keeps a valid conversationId and explicit language", () => {
    const parsed = knowledgeDraftCreateSchema.parse({
      title: "Câu hỏi",
      content: "Nội dung",
      conversationId: "11111111-1111-1111-1111-111111111111",
      language: "vi",
    });
    expect(parsed.conversationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.language).toBe("vi");
  });

  it("rejects empty content and a non-uuid conversationId", () => {
    expect(() => knowledgeDraftCreateSchema.parse({ title: "x", content: "   " })).toThrow();
    expect(() =>
      knowledgeDraftCreateSchema.parse({ title: "x", content: "y", conversationId: "nope" }),
    ).toThrow();
  });
});

describe("knowledgeDraftUpdateSchema", () => {
  it("accepts a title-only or content-only patch", () => {
    expect(knowledgeDraftUpdateSchema.parse({ title: "New" })).toEqual({ title: "New" });
    expect(knowledgeDraftUpdateSchema.parse({ content: "New body" })).toEqual({
      content: "New body",
    });
  });

  it("rejects an empty patch", () => {
    expect(() => knowledgeDraftUpdateSchema.parse({})).toThrow();
  });
});

describe("knowledgeDraftListQuerySchema", () => {
  it("defaults limit to 50 and coerces a numeric-string limit", () => {
    expect(knowledgeDraftListQuerySchema.parse({}).limit).toBe(50);
    expect(knowledgeDraftListQuerySchema.parse({ status: "expert_review", limit: "10" })).toEqual({
      status: "expert_review",
      limit: 10,
    });
  });

  it("rejects an unknown draft status", () => {
    expect(() => knowledgeDraftListQuerySchema.parse({ status: "archived" })).toThrow();
  });
});
