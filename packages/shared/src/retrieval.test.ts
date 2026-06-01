import {
  chunkStatusSchema,
  retrievalFiltersSchema,
  retrievalQuerySchema,
} from "./retrieval";

describe("chunkStatusSchema", () => {
  it("accepts known statuses and rejects unknown", () => {
    expect(chunkStatusSchema.parse("published")).toBe("published");
    expect(() => chunkStatusSchema.parse("live")).toThrow();
  });
});

describe("retrievalFiltersSchema", () => {
  it("defaults status to published when omitted", () => {
    const parsed = retrievalFiltersSchema.parse({});
    expect(parsed.status).toBe("published");
    expect(parsed.scope).toBeUndefined();
    expect(parsed.language).toBeUndefined();
  });

  it("accepts a scope list, language, and explicit status", () => {
    const parsed = retrievalFiltersSchema.parse({
      scope: ["global_expert", "tenant_customer"],
      language: "vi",
      status: "pending",
    });
    expect(parsed.scope).toEqual(["global_expert", "tenant_customer"]);
    expect(parsed.language).toBe("vi");
    expect(parsed.status).toBe("pending");
  });

  it("rejects an empty scope list and unknown scopes", () => {
    expect(() => retrievalFiltersSchema.parse({ scope: [] })).toThrow();
    expect(() => retrievalFiltersSchema.parse({ scope: ["nope"] })).toThrow();
  });
});

describe("retrievalQuerySchema", () => {
  it("applies defaults for topK and filters", () => {
    const parsed = retrievalQuerySchema.parse({ text: "how do I file taxes" });
    expect(parsed.topK).toBe(8);
    expect(parsed.filters.status).toBe("published");
  });

  it("trims text and rejects empty / over-long text", () => {
    expect(retrievalQuerySchema.parse({ text: "  hi  " }).text).toBe("hi");
    expect(() => retrievalQuerySchema.parse({ text: "   " })).toThrow();
    expect(() => retrievalQuerySchema.parse({ text: "x".repeat(2001) })).toThrow();
  });

  it("bounds topK to a sane range", () => {
    expect(() => retrievalQuerySchema.parse({ text: "q", topK: 0 })).toThrow();
    expect(() => retrievalQuerySchema.parse({ text: "q", topK: 51 })).toThrow();
    expect(() => retrievalQuerySchema.parse({ text: "q", topK: 2.5 })).toThrow();
  });
});
