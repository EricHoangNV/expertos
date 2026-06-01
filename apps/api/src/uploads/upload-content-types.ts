/**
 * Allowlisted query-time upload formats (M5.1, PRD §"Document-assisted Q&A": PDF, XLSX, CSV,
 * DOCX, Markdown, plain text) plus the data needed to validate a file against its declared type.
 *
 * Uploads are an untrusted trust boundary (PRD §"Security"): a declared `Content-Type` is
 * attacker-controlled, so {@link UploadService} cross-checks three things against this table —
 * the type is allowlisted, the filename extension is one this type legitimately uses, and (for
 * binary formats) the leading bytes match the format's magic number. Text formats have no
 * reliable signature, so `magic` is empty and the extension check carries the weight.
 */
export interface UploadTypeSpec {
  /** Canonical short kind — used for logging and (M5.2+) parser dispatch. */
  kind: "txt" | "md" | "csv" | "pdf" | "docx" | "xlsx";
  /** Filename extensions (lowercase, no dot) that legitimately carry this content type. */
  extensions: readonly string[];
  /**
   * Leading magic bytes every well-formed file of this type starts with (anti-spoof). Empty for
   * text formats, which have no reliable byte signature. XLSX/DOCX are ZIP containers (`PK`).
   */
  magic: readonly number[];
}

const PK_ZIP = [0x50, 0x4b] as const; // "PK" — XLSX/DOCX are OOXML ZIP containers
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // "%PDF"

/** Maps a normalized MIME type to its validation spec. The single source of allowed uploads. */
export const UPLOAD_TYPES: Readonly<Record<string, UploadTypeSpec>> = {
  "text/plain": { kind: "txt", extensions: ["txt"], magic: [] },
  "text/markdown": { kind: "md", extensions: ["md", "markdown"], magic: [] },
  "text/x-markdown": { kind: "md", extensions: ["md", "markdown"], magic: [] },
  "text/csv": { kind: "csv", extensions: ["csv"], magic: [] },
  "application/pdf": { kind: "pdf", extensions: ["pdf"], magic: [...PDF_MAGIC] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "xlsx",
    extensions: ["xlsx"],
    magic: [...PK_ZIP],
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "docx",
    extensions: ["docx"],
    magic: [...PK_ZIP],
  },
};

/**
 * Max upload size (10 MiB). Enforced twice: the controller's multer `limits.fileSize` rejects an
 * oversize stream before the whole body is buffered into memory (DoS guard), and
 * {@link UploadService} re-checks the buffered length as the structural, test-covered boundary.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Strip MIME parameters (`; charset=utf-8`), lowercase, trim — mirrors the parser registry. */
export function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}
