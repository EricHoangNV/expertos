import { type Parser, type ParsedDocument, toText } from "../parser";
import { renderSheets, type SheetTable } from "./spreadsheet";

/**
 * CSV parser. A CSV is a single, unnamed sheet: each data row becomes one structured
 * {@link ParsedDocument.chunks} entry (via {@link renderSheets}) carrying its A1 cell range
 * (e.g. `A2:C2`) so an upload citation can point at the row (M5.3). The flat `text` field renders
 * the same rows as `header: value` records separated by blank lines, for the text-only ingestion
 * pipeline (M1.1) which keeps the column context in each chunk. Handles RFC-4180 quoting (quoted
 * fields, embedded commas/newlines, `""` escapes).
 *
 * Rich binary spreadsheets — multiple sheets, real (stored) numeric values, sheet-level
 * citations — are the XLSX parser; both share the {@link renderSheets} chunking.
 */
export class CsvParser implements Parser {
  readonly contentTypes = ["text/csv", "csv"] as const;

  parse(raw: Buffer | string): Promise<ParsedDocument> {
    const rows = parseCsv(toText(raw));
    if (rows.length === 0) {
      return Promise.resolve({ text: "" });
    }

    const [headerRow, ...dataRows] = rows;
    const headers = headerRow.map((h) => h.trim());
    const sheet: SheetTable = { headers, rows: dataRows };
    const chunks = renderSheets([sheet]);

    // Keep the flat-text record rendering byte-stable for the M1.1 ingestion path.
    const records = dataRows
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .map((row) =>
        headers
          .map((header, i) => {
            const value = (row[i] ?? "").trim();
            return value === "" ? `${header}:` : `${header}: ${value}`;
          })
          .join("\n"),
      );

    return Promise.resolve({
      text: records.join("\n\n"),
      ...(chunks.length > 0 ? { chunks } : {}),
      metadata: { headers, rowCount: records.length },
    });
  }
}

/** Minimal RFC-4180 CSV tokenizer. Returns rows of string cells; trailing blank line ignored. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const text = input.replace(/\r\n?/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Flush the final cell/row unless the input ended on a clean newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
