/**
 * The `Parser` contract (M1.1, PRD §"Critical Files"). Every raw source format is
 * turned into plain text behind this single interface, so the ingestion pipeline never
 * knows whether a document came from Markdown, CSV, or (later) a sandboxed Python
 * PDF/XLSX worker — adding a format is a new `Parser`, not a pipeline change.
 *
 * Retrieved chunks + uploads are an untrusted trust boundary (PRD §"Security"): a
 * parser's job is extraction only; it must never execute or trust source content.
 */

/**
 * A pre-segmented chunk a parser emits when the source has natural, citable units that the
 * generic word-window {@link chunkText} would destroy — chiefly spreadsheet rows (M5.3). When a
 * {@link ParsedDocument} carries `chunks`, the upload indexer persists them verbatim (one
 * `upload_chunks` row each) instead of re-chunking `text`, so the row's `sheet_name`/`cell_ref`
 * provenance survives and a citation can point at a sheet/cell range.
 */
export interface ParsedChunk {
  /** Embeddable text for this unit (e.g. a row rendered as `header: value` lines). */
  content: string;
  /** Source sheet/tab name, when the format has named sheets (XLSX). Omitted for flat CSV. */
  sheetName?: string;
  /** A1-style cell reference or range this chunk covers (e.g. `A2:C2`), for citation. */
  cellRef?: string;
}

export interface ParsedDocument {
  /** Plain-text content extracted from the raw source, ready for chunking. */
  text: string;
  /** Optional structured metadata a parser may surface (e.g. CSV column headers). */
  metadata?: Record<string, unknown>;
  /**
   * Optional pre-segmented chunks with provenance (spreadsheets — M5.3). When present, the upload
   * indexer uses these instead of running {@link chunkText} over `text`; the text-only ingestion
   * pipeline (M1.1) ignores them and always chunks `text`, so this field is backward-compatible.
   */
  chunks?: ParsedChunk[];
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
