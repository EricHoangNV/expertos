import { ParserRegistry, UnsupportedContentTypeError } from "./parser-registry";
import { TextParser } from "./parsers/text-parser";
import { CsvParser } from "./parsers/csv-parser";

describe("ParserRegistry", () => {
  const registry = new ParserRegistry([new TextParser(), new CsvParser()]);

  it("resolves by MIME type", () => {
    expect(registry.resolve("text/markdown")).toBeInstanceOf(TextParser);
    expect(registry.resolve("text/csv")).toBeInstanceOf(CsvParser);
  });

  it("resolves by bare extension", () => {
    expect(registry.resolve("md")).toBeInstanceOf(TextParser);
    expect(registry.resolve("csv")).toBeInstanceOf(CsvParser);
  });

  it("is case-insensitive and ignores MIME parameters", () => {
    expect(registry.resolve("TEXT/Markdown; charset=utf-8")).toBeInstanceOf(TextParser);
  });

  it("throws UnsupportedContentTypeError for unknown types", () => {
    expect(() => registry.resolve("application/pdf")).toThrow(UnsupportedContentTypeError);
    try {
      registry.resolve("application/pdf");
    } catch (error) {
      expect((error as UnsupportedContentTypeError).contentType).toBe("application/pdf");
    }
  });
});
