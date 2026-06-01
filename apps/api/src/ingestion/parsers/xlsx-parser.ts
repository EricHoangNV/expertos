import { type Parser, type ParsedDocument } from "../parser";
import { renderSheets, renderText, type SheetTable } from "./spreadsheet";
import { openZip, InvalidZipError, type ZipArchive } from "./zip";

/**
 * XLSX (OOXML spreadsheet) parser — the structured, multi-sheet counterpart of the CSV parser
 * (M5.3, PRD §"Document-assisted Q&A": "proper spreadsheet handling … real numeric values, cite
 * sheet/table location"). An .xlsx is a ZIP of XML; this reads it dependency-free via {@link openZip}
 * and surfaces, per sheet:
 *  - the sheet **name** (from `xl/workbook.xml`),
 *  - **real stored values** — the underlying `<v>` of each cell, not the display-formatted string,
 *    so a numeric answer grounds on the true number, and
 *  - per-row chunks tagged with sheet name + A1 cell range (via {@link renderSheets}) so a citation
 *    can point at a sheet/row.
 *
 * Parsing is read-only extraction (PRD §"Security"): no formula evaluation, no external-entity or
 * relationship following beyond the worksheet/shared-string/workbook parts, and the ZIP reader caps
 * inflated size. A malformed file throws {@link InvalidZipError}; the upload service treats a parse
 * failure as "stored, not indexed" rather than a crash.
 */
export class XlsxParser implements Parser {
  readonly contentTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsx",
  ] as const;

  // `async` so a malformed-container throw surfaces as a rejected promise (the Parser contract is
  // Promise-returning), letting the upload service treat it as "stored, not indexed".
  async parse(raw: Buffer | string): Promise<ParsedDocument> {
    if (typeof raw === "string") {
      throw new InvalidZipError("XLSX must be parsed from binary, not a string");
    }
    const zip = openZip(raw);
    const sharedStrings = readSharedStrings(zip);
    const sheets = readSheets(zip, sharedStrings);

    const chunks = renderSheets(sheets);
    const text = renderText(sheets);
    return {
      text,
      ...(chunks.length > 0 ? { chunks } : {}),
      metadata: { sheetNames: sheets.map((s) => s.name ?? "") },
    };
  }
}

/** A `<sheet name=… r:id=…>` from the workbook, paired with the worksheet part it points at. */
interface SheetRef {
  name: string;
  path: string;
}

/** Resolve the ordered list of worksheet parts + their display names from the workbook + rels. */
function resolveSheetRefs(zip: ZipArchive): SheetRef[] {
  const workbook = zip.readText("xl/workbook.xml");
  if (!workbook) {
    return [];
  }
  const rels = parseRelationships(zip.readText("xl/_rels/workbook.xml.rels") ?? "");
  const refs: SheetRef[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = match[0];
    const name = decodeXml(attr(tag, "name") ?? "");
    const rid = attr(tag, "r:id");
    const target = rid ? rels.get(rid) : undefined;
    if (!target) {
      continue;
    }
    refs.push({ name, path: resolvePartPath(target) });
  }
  return refs;
}

/** Read every worksheet into a {@link SheetTable} (row 1 = headers, rows 2… = data). */
function readSheets(zip: ZipArchive, sharedStrings: string[]): SheetTable[] {
  const sheets: SheetTable[] = [];
  for (const ref of resolveSheetRefs(zip)) {
    const xml = zip.readText(ref.path);
    if (!xml) {
      continue;
    }
    const grid = parseWorksheet(xml, sharedStrings);
    if (grid.length === 0) {
      continue;
    }
    const [headers, ...rows] = grid;
    sheets.push({ name: ref.name || undefined, headers, rows });
  }
  return sheets;
}

/**
 * Parse a worksheet's `<row>`/`<c>` cells into a dense grid of stringified values. Each cell's
 * value is its real stored content: a shared-string lookup (`t="s"`), an inline string
 * (`t="inlineStr"`), a formula's cached string (`t="str"`), a boolean (`t="b"`), or — the common
 * case — the raw numeric `<v>` (so "1200000" stays "1200000", never a formatted "1.2M").
 */
function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const grid: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    const body = rowMatch[1];
    for (const cellMatch of body.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = cellMatch[1];
      const inner = cellMatch[2] ?? "";
      const col = colIndexFromRef(attr(`<c ${cellAttrs}>`, "r"));
      const value = cellValue(attr(`<c ${cellAttrs}>`, "t"), inner, sharedStrings);
      if (col >= 0) {
        cells[col] = value;
      } else {
        cells.push(value);
      }
    }
    // Densify holes left by sparse cells (skipped empty columns) into empty strings.
    grid.push(Array.from(cells, (v) => v ?? ""));
  }
  return grid;
}

/** Extract a single cell's stored value as a string, given its `t` (type) attribute + inner XML. */
function cellValue(type: string | undefined, inner: string, sharedStrings: string[]): string {
  if (type === "inlineStr") {
    return collectText(inner);
  }
  const raw = decodeXml(firstTag(inner, "v") ?? "");
  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
  }
  if (type === "b") {
    return raw === "1" ? "TRUE" : "FALSE";
  }
  // "str" (formula cached string), "n" (number), or no type → the raw stored value verbatim.
  return raw;
}

/** Read `xl/sharedStrings.xml` into an index→string table (concatenating rich-text `<t>` runs). */
function readSharedStrings(zip: ZipArchive): string[] {
  const xml = zip.readText("xl/sharedStrings.xml");
  if (!xml) {
    return [];
  }
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(collectText(si[1]));
  }
  return strings;
}

/** Parse a `.rels` part into a map of Relationship Id → Target. */
function parseRelationships(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) {
      map.set(id, decodeXml(target));
    }
  }
  return map;
}

/** Concatenate the decoded text of every `<t>` element within an XML fragment (rich-text runs). */
function collectText(fragment: string): string {
  let out = "";
  for (const t of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    out += decodeXml(t[1]);
  }
  return out;
}

/** The text of the first `<name>…</name>` element in a fragment, or null. */
function firstTag(fragment: string, name: string): string | null {
  const match = fragment.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? match[1] : null;
}

/** Read an attribute value from a start tag, or undefined. */
function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name.replace(":", "\\:")}="([^"]*)"`));
  return match ? match[1] : undefined;
}

/** Resolve a worksheet relationship Target (usually `worksheets/sheet1.xml`) to its zip path. */
function resolvePartPath(target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1); // absolute within the package
  }
  return `xl/${target.replace(/^\.\//, "")}`;
}

/** Column index (0-based) from an A1 cell ref like `B2` → 1. Returns -1 when absent/unparseable. */
function colIndexFromRef(ref: string | undefined): number {
  if (!ref) {
    return -1;
  }
  const letters = ref.match(/^[A-Z]+/i)?.[0];
  if (!letters) {
    return -1;
  }
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Decode the five predefined XML entities plus numeric (`&#nn;` / `&#xnn;`) character references. */
function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return whole;
    }
  });
}
