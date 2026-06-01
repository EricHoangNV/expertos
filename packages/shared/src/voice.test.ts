import {
  voiceQuerySchema,
  expertListQuerySchema,
  voiceProfileCreateSchema,
  voiceProfileUpdateSchema,
  voiceProfileListQuerySchema,
} from "./voice";

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

describe("expertListQuerySchema", () => {
  it("defaults limit to 20 and leaves language unset (lists all experts)", () => {
    const parsed = expertListQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.language).toBeUndefined();
  });

  it("narrows to a language when given", () => {
    expect(expertListQuerySchema.parse({ language: "vi" }).language).toBe("vi");
  });

  it("bounds limit to 1..100", () => {
    expect(() => expertListQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => expertListQuerySchema.parse({ limit: 101 })).toThrow();
    expect(expertListQuerySchema.parse({ limit: 1 }).limit).toBe(1);
    expect(expertListQuerySchema.parse({ limit: 100 }).limit).toBe(100);
  });

  it("rejects a non-integer limit and an unknown language", () => {
    expect(() => expertListQuerySchema.parse({ limit: 2.5 })).toThrow();
    expect(() => expertListQuerySchema.parse({ language: "fr" })).toThrow();
  });
});

describe("voiceProfileCreateSchema", () => {
  const base = { expertId: UUID, name: "Direct & practical" };

  it("defaults language to en and leaves optional fields undefined", () => {
    const parsed = voiceProfileCreateSchema.parse(base);
    expect(parsed.language).toBe("en");
    expect(parsed.description).toBeUndefined();
    expect(parsed.guidelines).toBeUndefined();
  });

  it("requires a uuid expertId and a non-empty name", () => {
    expect(() => voiceProfileCreateSchema.parse({ expertId: "x", name: "n" })).toThrow();
    expect(() => voiceProfileCreateSchema.parse({ expertId: UUID, name: "   " })).toThrow();
  });

  it("bounds field lengths and rejects unknown languages", () => {
    expect(() =>
      voiceProfileCreateSchema.parse({ ...base, name: "x".repeat(101) }),
    ).toThrow();
    expect(() =>
      voiceProfileCreateSchema.parse({ ...base, description: "x".repeat(501) }),
    ).toThrow();
    expect(() =>
      voiceProfileCreateSchema.parse({ ...base, guidelines: "x".repeat(2001) }),
    ).toThrow();
    expect(() => voiceProfileCreateSchema.parse({ ...base, language: "fr" })).toThrow();
  });

  it("trims and NFC-normalizes the text fields", () => {
    const decomposed = "Định giá".normalize("NFD");
    const parsed = voiceProfileCreateSchema.parse({
      expertId: UUID,
      language: "vi",
      name: `  ${decomposed}  `,
      guidelines: ` ${decomposed} `,
    });
    expect(parsed.name).toBe("Định giá".normalize("NFC"));
    expect(parsed.guidelines).toBe("Định giá".normalize("NFC"));
    expect(parsed.language).toBe("vi");
  });
});

describe("voiceProfileUpdateSchema", () => {
  it("accepts a partial patch of a single field", () => {
    expect(voiceProfileUpdateSchema.parse({ name: "New name" }).name).toBe("New name");
  });

  it("allows clearing description/guidelines with an empty string", () => {
    const parsed = voiceProfileUpdateSchema.parse({ description: "", guidelines: "" });
    expect(parsed.description).toBe("");
    expect(parsed.guidelines).toBe("");
  });

  it("rejects an empty patch", () => {
    expect(() => voiceProfileUpdateSchema.parse({})).toThrow();
  });

  it("rejects an empty name (only description/guidelines may be blank)", () => {
    expect(() => voiceProfileUpdateSchema.parse({ name: "   " })).toThrow();
  });
});

describe("voiceProfileListQuerySchema", () => {
  it("defaults limit to 50 and leaves filters unset", () => {
    const parsed = voiceProfileListQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.status).toBeUndefined();
    expect(parsed.expertId).toBeUndefined();
    expect(parsed.language).toBeUndefined();
  });

  it("coerces a query-string limit and narrows by status/expert/language", () => {
    const parsed = voiceProfileListQuerySchema.parse({
      status: "expert_review",
      expertId: UUID,
      language: "vi",
      limit: "10",
    });
    expect(parsed.limit).toBe(10);
    expect(parsed.status).toBe("expert_review");
    expect(parsed.expertId).toBe(UUID);
    expect(parsed.language).toBe("vi");
  });

  it("rejects an out-of-range limit, unknown status, and non-uuid expertId", () => {
    expect(() => voiceProfileListQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => voiceProfileListQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => voiceProfileListQuerySchema.parse({ status: "retired" })).toThrow();
    expect(() => voiceProfileListQuerySchema.parse({ expertId: "nope" })).toThrow();
  });
});
