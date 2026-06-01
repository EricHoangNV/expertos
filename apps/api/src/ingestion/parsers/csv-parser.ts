import { type Parser, type ParsedDocument, toText } from "../parser";

/**
 * CSV parser. Each data row is rendered as `header: value` lines and rows are separated
 * by blank lines, so the chunker keeps a record together and the embedding sees the
 * column context (not bare cell values). Handles RFC-4180 quoting (quoted fields,
 * embedded commas/newlines, `""` escapes).
 *
 * This is the lightweight text-CSV path. Rich spreadsheet handling — multiple sheets,
 * numeric typing, sheet/cell-level citations — is M5 and slots in as its own `Parser`.
 */
export class CsvParser implements Parser {
  readonly contentTypes = ["text/csv", "csv"] as const;

  parse(raw: Buffer | string): Promise<ParsedDocument> {
    const rows = parseCsv(toText(raw));
    if (rows.length === 0) {
      return Promise.resolve({ text: "" });
    }

    const [headers, ...dataRows] = rows;
    const records = dataRows
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .map((row) =>
        headers
          .map((header, i) => {
            const value = (row[i] ?? "").trim();
            return value === "" ? `${header.trim()}:` : `${header.trim()}: ${value}`;
          })
          .join("\n"),
      );

    return Promise.resolve({
      text: records.join("\n\n"),
      metadata: { headers: headers.map((h) => h.trim()), rowCount: records.length },
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
