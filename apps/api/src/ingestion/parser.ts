/**
 * The `Parser` contract (M1.1, PRD §"Critical Files"). Every raw source format is
 * turned into plain text behind this single interface, so the ingestion pipeline never
 * knows whether a document came from Markdown, CSV, or (later) a sandboxed Python
 * PDF/XLSX worker — adding a format is a new `Parser`, not a pipeline change.
 *
 * Retrieved chunks + uploads are an untrusted trust boundary (PRD §"Security"): a
 * parser's job is extraction only; it must never execute or trust source content.
 */

export interface ParsedDocument {
  /** Plain-text content extracted from the raw source, ready for chunking. */
  text: string;
  /** Optional structured metadata a parser may surface (e.g. CSV column headers). */
  metadata?: Record<string, unknown>;
}

export interface Parser {
  /**
   * Content types this parser handles — MIME types (`text/markdown`) and/or bare file
   * extensions (`md`). Matched case-insensitively by the {@link ParserRegistry}.
   */
  readonly contentTypes: readonly string[];
  parse(raw: Buffer | string): Promise<ParsedDocument>;
}

/** Normalize a raw `Buffer | string` to a UTF-8 string for text-based parsers. */
export function toText(raw: Buffer | string): string {
  return typeof raw === "string" ? raw : raw.toString("utf8");
}
