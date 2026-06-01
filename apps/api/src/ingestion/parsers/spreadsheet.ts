import { normalizeText } from "@expertos/ai";
import type { ParsedChunk } from "../parser";

/**
 * A single parsed sheet/table: a header row plus data rows of already-stringified cell values.
 * Both the CSV and XLSX parsers normalize their source into this shape, then {@link renderSheets}
 * turns it into per-row {@link ParsedChunk}s — so spreadsheet chunking, cell-ref formatting and the
 * untrusted-boundary row cap live in exactly one place (M5.3, PRD §"Document-assisted Q&A").
 */
export interface SheetTable {
  /** Sheet/tab name, when the format has one (XLSX). Omitted for a flat CSV. */
  name?: string;
  /** Column headers (row 1). May be empty cells; used as the `header:` label per value. */
  headers: string[];
  /** Data rows (row 2…). Each is an array of stringified cell values aligned to `headers`. */
  rows: string[][];
}

/**
 * Max data rows indexed per upload across all sheets. Spreadsheets are an untrusted boundary
 * (PRD §"Security") and we emit one embedded chunk per row, so an unbounded sheet would be a cost
 * / memory amplification vector — rows beyond the cap are dropped from the index (the file is still
 * stored). Generous for the target use (KPI / financial reports are hundreds of rows).
 */
export const MAX_SPREADSHEET_ROWS = 5000;

/** Convert a zero-based column index to its A1 letter(s): 0→A, 25→Z, 26→AA. */
export function columnLetter(index: number): string {
  let n = index;
  let letter = "";
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

/**
 * Render parsed sheets into per-row chunks. Each data row becomes one chunk whose content is the
 * row's cells as `header: value` lines (so the embedding sees column context and the real values,
 * not bare cells), tagged with the sheet name and the row's A1 cell range (e.g. `A2:C2`) for
 * citation. Fully blank rows are skipped; the total is capped at {@link MAX_SPREADSHEET_ROWS}.
 */
export function renderSheets(sheets: SheetTable[]): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  for (const sheet of sheets) {
    const headers = sheet.headers.map((h) => normalizeText(h).trim());
    // Header occupies row 1; the first data row is therefore spreadsheet row 2.
    let rowNumber = 1;
    for (const row of sheet.rows) {
      rowNumber += 1;
      if (chunks.length >= MAX_SPREADSHEET_ROWS) {
        return chunks;
      }
      const values = row.map((v) => normalizeText(v).trim());
      if (values.every((v) => v === "")) {
        continue; // wholly blank row — nothing to embed or cite
      }
      const width = Math.max(headers.length, values.length);
      const lines: string[] = [];
      for (let col = 0; col < width; col++) {
        const value = values[col] ?? "";
        if (value === "") {
          continue; // skip empty cells so the chunk stays about the row's real data
        }
        const header = headers[col] ?? "";
        lines.push(header === "" ? value : `${header}: ${value}`);
      }
      if (lines.length === 0) {
        continue;
      }
      const lastCol = Math.max(0, width - 1);
      const cellRef = `${columnLetter(0)}${rowNumber}:${columnLetter(lastCol)}${rowNumber}`;
      const heading = sheet.name ? `Sheet: ${sheet.name} (row ${rowNumber})\n` : "";
      chunks.push({
        content: `${heading}${lines.join("\n")}`,
        ...(sheet.name ? { sheetName: sheet.name } : {}),
        cellRef,
      });
    }
  }
  return chunks;
}

/**
 * The flat-text rendering of the same sheets, for the {@link ParsedDocument.text} field that the
 * text-only ingestion pipeline (M1.1) consumes. Rows are `header: value` blocks separated by blank
 * lines, sheets prefixed by a `# <name>` heading when named — mirrors the per-row chunk content so
 * the two representations stay consistent.
 */
export function renderText(sheets: SheetTable[]): string {
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const headers = sheet.headers.map((h) => normalizeText(h).trim());
    const records: string[] = [];
    for (const row of sheet.rows) {
      const values = row.map((v) => normalizeText(v).trim());
      if (values.every((v) => v === "")) {
        continue;
      }
      const width = Math.max(headers.length, values.length);
      const lines: string[] = [];
      for (let col = 0; col < width; col++) {
        const value = values[col] ?? "";
        if (value === "") {
          continue;
        }
        const header = headers[col] ?? "";
        lines.push(header === "" ? value : `${header}: ${value}`);
      }
      if (lines.length > 0) {
        records.push(lines.join("\n"));
      }
    }
    if (records.length === 0) {
      continue;
    }
    const body = records.join("\n\n");
    blocks.push(sheet.name ? `# ${sheet.name}\n${body}` : body);
  }
  return blocks.join("\n\n");
}
