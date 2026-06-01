import { CsvParser } from "./csv-parser";

describe("CsvParser", () => {
  const parser = new CsvParser();

  it("renders each data row as header: value lines, records blank-separated", async () => {
    const out = await parser.parse("name,role\nAda,engineer\nGrace,admiral");
    expect(out.text).toBe(
      "name: Ada\nrole: engineer\n\nname: Grace\nrole: admiral",
    );
    expect(out.metadata).toEqual({ headers: ["name", "role"], rowCount: 2 });
  });

  it("handles quoted fields with embedded commas and newlines", async () => {
    const out = await parser.parse('a,b\n"x,y","line1\nline2"');
    expect(out.text).toBe("a: x,y\nb: line1\nline2");
  });

  it("unescapes doubled quotes", async () => {
    const out = await parser.parse('q\n"she said ""hi"""');
    expect(out.text).toBe('q: she said "hi"');
  });

  it("skips fully-blank data rows", async () => {
    const out = await parser.parse("a,b\n,\nv1,v2");
    expect(out.text).toBe("a: v1\nb: v2");
    expect(out.metadata).toMatchObject({ rowCount: 1 });
  });

  it("pads missing trailing cells", async () => {
    const out = await parser.parse("a,b,c\n1,2");
    expect(out.text).toBe("a: 1\nb: 2\nc:");
  });

  it("emits one structured chunk per data row with an A1 cell range (no sheet name)", async () => {
    const out = await parser.parse("name,role\nAda,engineer\nGrace,admiral");
    expect(out.chunks).toEqual([
      { content: "name: Ada\nrole: engineer", cellRef: "A2:B2" },
      { content: "name: Grace\nrole: admiral", cellRef: "A3:B3" },
    ]);
    // CSV has no named sheets.
    expect(out.chunks?.every((c) => c.sheetName === undefined)).toBe(true);
  });

  it("omits chunks for a header-only file", async () => {
    const out = await parser.parse("a,b\n");
    expect(out.chunks).toBeUndefined();
  });

  it("returns empty text for empty input", async () => {
    const out = await parser.parse("");
    expect(out.text).toBe("");
  });

  it("handles a header-only file (no data rows)", async () => {
    const out = await parser.parse("a,b\n");
    expect(out.text).toBe("");
    expect(out.metadata).toMatchObject({ headers: ["a", "b"], rowCount: 0 });
  });
});
