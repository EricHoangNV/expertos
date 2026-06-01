import type { Parser } from "./parser";

/** Thrown when no registered parser handles a requested content type. */
export class UnsupportedContentTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`No parser registered for content type: ${contentType}`);
    this.name = "UnsupportedContentTypeError";
  }
}

/** Strip MIME parameters (`; charset=utf-8`), lowercase, trim. */
function normalize(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Resolves a content type to its {@link Parser}. PDF/DOCX/XLSX are intentionally absent
 * in M1.1 — `resolve` throws {@link UnsupportedContentTypeError} for them, which is the
 * seam where M5's spreadsheet/PDF parsers (or a Python worker) register later.
 */
export class ParserRegistry {
  private readonly byType = new Map<string, Parser>();

  constructor(parsers: Parser[]) {
    for (const parser of parsers) {
      for (const type of parser.contentTypes) {
        this.byType.set(normalize(type), parser);
      }
    }
  }

  resolve(contentType: string): Parser {
    const parser = this.byType.get(normalize(contentType));
    if (!parser) {
      throw new UnsupportedContentTypeError(contentType);
    }
    return parser;
  }
}
