import { deflateRawSync } from "node:zlib";
import { XlsxParser } from "./xlsx-parser";
import { InvalidZipError } from "./zip";

interface ZipEntry {
  name: string;
  content: string;
  /** Use method 0 (stored) instead of method 8 (deflate). Default: deflate. */
  stored?: boolean;
}

/** Build a minimal valid ZIP container (the OOXML XLSX wire format) from string entries. */
function makeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, content, stored } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const uncompressed = Buffer.from(content, "utf8");
    const data = stored ? uncompressed : deflateRawSync(uncompressed);
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(uncompressed.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns:r="x"><sheets>
  <sheet name="Q1 KPIs" sheetId="1" r:id="rId1"/>
  <sheet name="Notes" sheetId="2" r:id="rId2"/>
</sheets></workbook>`;

const RELS = `<?xml version="1.0"?><Relationships>
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
</Relationships>`;

const SHARED = `<?xml version="1.0"?><sst>
  <si><t>Region</t></si>
  <si><t>Revenue</t></si>
  <si><t>APAC</t></si>
  <si><r><t>EM</t></r><r><t>EA</t></r></si>
</sst>`;

// Row 1 = headers (shared strings 0,1). Row 2/3 = a string region + a real numeric revenue.
const SHEET1 = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200000</v></c></row>
  <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>980000.5</v></c></row>
</sheetData></worksheet>`;

const SHEET2 = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Comment</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>on track &amp; growing</t></is></c></row>
</sheetData></worksheet>`;

function workbookZip(): Buffer {
  return makeZip([
    { name: "xl/workbook.xml", content: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", content: RELS },
    { name: "xl/sharedStrings.xml", content: SHARED },
    { name: "xl/worksheets/sheet1.xml", content: SHEET1 },
    { name: "xl/worksheets/sheet2.xml", content: SHEET2 },
  ]);
}

describe("XlsxParser", () => {
  const parser = new XlsxParser();

  it("emits per-row chunks with sheet name, cell range, and REAL numeric values", async () => {
    const out = await parser.parse(workbookZip());
    const sheet1 = out.chunks?.filter((c) => c.sheetName === "Q1 KPIs");
    expect(sheet1).toEqual([
      {
        content: "Sheet: Q1 KPIs (row 2)\nRegion: APAC\nRevenue: 1200000",
        sheetName: "Q1 KPIs",
        cellRef: "A2:B2",
      },
      {
        content: "Sheet: Q1 KPIs (row 3)\nRegion: EMEA\nRevenue: 980000.5",
        sheetName: "Q1 KPIs",
        cellRef: "A3:B3",
      },
    ]);
  });

  it("resolves shared strings, including rich-text runs (EM+EA → EMEA)", async () => {
    const out = await parser.parse(workbookZip());
    expect(out.chunks?.some((c) => c.content.includes("Region: EMEA"))).toBe(true);
  });

  it("reads inline strings and decodes XML entities on a second sheet", async () => {
    const out = await parser.parse(workbookZip());
    const notes = out.chunks?.find((c) => c.sheetName === "Notes");
    expect(notes?.content).toBe("Sheet: Notes (row 2)\nComment: on track & growing");
  });

  it("surfaces sheet names in metadata and a flat text rendering", async () => {
    const out = await parser.parse(workbookZip());
    expect(out.metadata).toEqual({ sheetNames: ["Q1 KPIs", "Notes"] });
    expect(out.text).toContain("# Q1 KPIs");
    expect(out.text).toContain("Revenue: 1200000");
  });

  it("handles stored (uncompressed) zip entries", async () => {
    const zip = makeZip([
      { name: "xl/workbook.xml", content: WORKBOOK, stored: true },
      { name: "xl/_rels/workbook.xml.rels", content: RELS, stored: true },
      { name: "xl/sharedStrings.xml", content: SHARED, stored: true },
      { name: "xl/worksheets/sheet1.xml", content: SHEET1, stored: true },
      { name: "xl/worksheets/sheet2.xml", content: SHEET2, stored: true },
    ]);
    const out = await parser.parse(zip);
    expect(out.chunks?.length).toBeGreaterThan(0);
  });

  it("yields no chunks for a workbook with no sheet rows", async () => {
    const zip = makeZip([
      {
        name: "xl/workbook.xml",
        content: `<workbook xmlns:r="x"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
      { name: "xl/worksheets/sheet1.xml", content: `<worksheet><sheetData></sheetData></worksheet>` },
    ]);
    const out = await parser.parse(zip);
    expect(out.chunks).toBeUndefined();
    expect(out.text).toBe("");
  });

  it("throws InvalidZipError on a non-ZIP buffer", async () => {
    await expect(parser.parse(Buffer.from("not a zip at all"))).rejects.toBeInstanceOf(
      InvalidZipError,
    );
  });

  it("rejects string input (XLSX is binary)", async () => {
    await expect(parser.parse("oops")).rejects.toBeInstanceOf(InvalidZipError);
  });
});
