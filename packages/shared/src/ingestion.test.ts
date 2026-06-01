import {
  contentScopeSchema,
  languageSchema,
  ingestionInputSchema,
} from "./ingestion";

describe("contentScopeSchema / languageSchema", () => {
  it("accepts known scopes and languages", () => {
    expect(contentScopeSchema.parse("global_expert")).toBe("global_expert");
    expect(languageSchema.parse("vi")).toBe("vi");
  });

  it("rejects unknown values", () => {
    expect(() => contentScopeSchema.parse("nope")).toThrow();
    expect(() => languageSchema.parse("fr")).toThrow();
  });
});

describe("ingestionInputSchema", () => {
  it("applies defaults for scope and language", () => {
    const parsed = ingestionInputSchema.parse({
      sourceUri: "gs://bucket/doc.md",
      title: "Tax Basics",
      contentType: "text/markdown",
    });
    expect(parsed.scope).toBe("global_expert");
    expect(parsed.language).toBe("en");
    expect(parsed.changeSummary).toBeUndefined();
  });

  it("trims string fields", () => {
    const parsed = ingestionInputSchema.parse({
      sourceUri: "  gs://bucket/doc.md  ",
      title: "  Tax Basics  ",
      contentType: "  text/markdown  ",
      changeSummary: "  initial load  ",
    });
    expect(parsed.sourceUri).toBe("gs://bucket/doc.md");
    expect(parsed.title).toBe("Tax Basics");
    expect(parsed.contentType).toBe("text/markdown");
    expect(parsed.changeSummary).toBe("initial load");
  });

  it("rejects empty required fields", () => {
    expect(() =>
      ingestionInputSchema.parse({ sourceUri: "", title: "x", contentType: "text/plain" }),
    ).toThrow();
    expect(() =>
      ingestionInputSchema.parse({ sourceUri: "x", title: "   ", contentType: "text/plain" }),
    ).toThrow();
  });

  it("enforces length bounds", () => {
    expect(() =>
      ingestionInputSchema.parse({
        sourceUri: "g",
        title: "x".repeat(301),
        contentType: "text/plain",
      }),
    ).toThrow();
  });

  it("accepts an explicit Vietnamese tenant-customer document", () => {
    const parsed = ingestionInputSchema.parse({
      sourceUri: "gs://bucket/vi.md",
      title: "Thuế",
      contentType: "text/markdown",
      scope: "tenant_customer",
      language: "vi",
    });
    expect(parsed.scope).toBe("tenant_customer");
    expect(parsed.language).toBe("vi");
  });
});
