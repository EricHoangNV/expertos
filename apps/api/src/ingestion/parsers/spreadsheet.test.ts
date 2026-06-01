import {
  columnLetter,
  renderSheets,
  renderText,
  MAX_SPREADSHEET_ROWS,
  type SheetTable,
} from "./spreadsheet";

describe("columnLetter", () => {
  it("maps 0-based indexes to A1 column letters", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("renderSheets", () => {
  it("renders one chunk per data row with sheet name + cell range", () => {
    const sheet: SheetTable = {
      name: "Q1",
      headers: ["Region", "Revenue"],
      rows: [
        ["APAC", "1200000"],
        ["EMEA", "980000"],
      ],
    };
    const chunks = renderSheets([sheet]);
    expect(chunks).toEqual([
      {
        content: "Sheet: Q1 (row 2)\nRegion: APAC\nRevenue: 1200000",
        sheetName: "Q1",
        cellRef: "A2:B2",
      },
      {
        content: "Sheet: Q1 (row 3)\nRegion: EMEA\nRevenue: 980000",
        sheetName: "Q1",
        cellRef: "A3:B3",
      },
    ]);
  });

  it("skips wholly-blank rows but keeps the row number aligned to the source", () => {
    const sheet: SheetTable = {
      headers: ["a", "b"],
      rows: [["", ""], ["x", "y"]],
    };
    const chunks = renderSheets([sheet]);
    expect(chunks).toHaveLength(1);
    // The kept row is source row 3, not 2 — the blank row still consumes a row number.
    expect(chunks[0].cellRef).toBe("A3:B3");
  });

  it("omits empty cells from a row's content", () => {
    const chunks = renderSheets([
      { headers: ["a", "b", "c"], rows: [["1", "", "3"]] },
    ]);
    expect(chunks[0].content).toBe("a: 1\nc: 3");
    // The cell range still spans the full table width.
    expect(chunks[0].cellRef).toBe("A2:C2");
  });

  it("caps the number of indexed rows at MAX_SPREADSHEET_ROWS", () => {
    const rows = Array.from({ length: MAX_SPREADSHEET_ROWS + 50 }, (_, i) => [`v${i}`]);
    const chunks = renderSheets([{ headers: ["x"], rows }]);
    expect(chunks).toHaveLength(MAX_SPREADSHEET_ROWS);
  });

  it("spans multiple sheets", () => {
    const chunks = renderSheets([
      { name: "One", headers: ["a"], rows: [["1"]] },
      { name: "Two", headers: ["b"], rows: [["2"]] },
    ]);
    expect(chunks.map((c) => c.sheetName)).toEqual(["One", "Two"]);
  });
});

describe("renderText", () => {
  it("renders named sheets as headed record blocks", () => {
    const text = renderText([
      { name: "Q1", headers: ["Region", "Revenue"], rows: [["APAC", "1200000"]] },
    ]);
    expect(text).toBe("# Q1\nRegion: APAC\nRevenue: 1200000");
  });

  it("drops sheets that have no non-blank rows", () => {
    const text = renderText([
      { name: "Empty", headers: ["a"], rows: [[""]] },
      { name: "Full", headers: ["a"], rows: [["1"]] },
    ]);
    expect(text).toBe("# Full\na: 1");
  });
});
