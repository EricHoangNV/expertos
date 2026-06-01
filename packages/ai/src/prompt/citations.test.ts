import { buildCitations } from "./citations";
import type { CitationSource } from "./citations";

const SOURCES: CitationSource[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "The standard VAT rate is 10%." },
  { chunkId: "c2", documentVersionId: "dv2", content: "Returns are filed quarterly." },
  { chunkId: "c3", documentVersionId: "dv1", content: "Late filing incurs a penalty." },
];

describe("buildCitations", () => {
  it("resolves adjacent markers to ordinal-indexed citations and leaves the prose verbatim", () => {
    const built = buildCitations({ answer: "The rate is 10% [1] and returns are quarterly [2].", citations: SOURCES });
    expect(built.text).toBe("The rate is 10% [1] and returns are quarterly [2].");
    expect(built.citations).toEqual([
      { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: SOURCES[0].content, kind: "knowledge" },
      { ordinal: 2, chunkId: "c2", documentVersionId: "dv2", content: SOURCES[1].content, kind: "knowledge" },
    ]);
  });

  it("emits ONLY referenced sources and does NOT renumber (a lone [2] stays ordinal 2)", () => {
    const built = buildCitations({ answer: "Filed quarterly [2].", citations: SOURCES });
    expect(built.text).toBe("Filed quarterly [2].");
    expect(built.citations).toEqual([
      { ordinal: 2, chunkId: "c2", documentVersionId: "dv2", content: SOURCES[1].content, kind: "knowledge" },
    ]);
  });

  it("treats adjacent and comma/space separated runs as multiple markers", () => {
    expect(buildCitations({ answer: "x [1][3]", citations: SOURCES }).citations.map((c) => c.ordinal)).toEqual([1, 3]);
    expect(buildCitations({ answer: "x [1, 2]", citations: SOURCES }).citations.map((c) => c.ordinal)).toEqual([1, 2]);
    expect(buildCitations({ answer: "x [1 3]", citations: SOURCES }).citations.map((c) => c.ordinal)).toEqual([1, 3]);
  });

  it("strips out-of-range markers ([0], [99]) from the text and the list", () => {
    const built = buildCitations({ answer: "Real [1] fake [99] zero [0].", citations: SOURCES });
    expect(built.text).toBe("Real [1] fake zero.");
    expect(built.citations.map((c) => c.ordinal)).toEqual([1]);
  });

  it("collapses spacing left by a removed marker, including before punctuation", () => {
    expect(buildCitations({ answer: "foo [9] bar", citations: SOURCES }).text).toBe("foo bar");
    expect(buildCitations({ answer: "foo [9].", citations: SOURCES }).text).toBe("foo.");
  });

  it("leaves non-numeric brackets as literal prose", () => {
    const built = buildCitations({ answer: "see config[abc] and array[0..n]", citations: SOURCES });
    expect(built.text).toBe("see config[abc] and array[0..n]");
    expect(built.citations).toEqual([]);
  });

  it("parses a [1]-[3] range as two independent markers", () => {
    const built = buildCitations({ answer: "rules [1]-[3] apply", citations: SOURCES });
    expect(built.text).toBe("rules [1]-[3] apply");
    expect(built.citations.map((c) => c.ordinal)).toEqual([1, 3]);
  });

  it("de-duplicates a source cited twice but keeps both markers in the prose", () => {
    const built = buildCitations({ answer: "First [1]. Again [1].", citations: SOURCES });
    expect(built.text).toBe("First [1]. Again [1].");
    expect(built.citations.map((c) => c.ordinal)).toEqual([1]);
  });

  it("keeps a mixed group verbatim when at least one member resolves", () => {
    const built = buildCitations({ answer: "x [1,99] y", citations: SOURCES });
    expect(built.text).toBe("x [1,99] y");
    expect(built.citations.map((c) => c.ordinal)).toEqual([1]);
  });

  it("strips every marker and returns no citations when the source table is empty", () => {
    const built = buildCitations({ answer: "No sources here [1][2].", citations: [] });
    expect(built.text).toBe("No sources here.");
    expect(built.citations).toEqual([]);
  });

  it("returns the answer unchanged when there are no markers at all", () => {
    const built = buildCitations({ answer: "Just prose, no citations.", citations: SOURCES });
    expect(built.text).toBe("Just prose, no citations.");
    expect(built.citations).toEqual([]);
  });

  it("defaults kind to knowledge but preserves an explicit upload kind", () => {
    const upload: CitationSource[] = [
      { chunkId: "u1", documentVersionId: "uv1", content: "from an upload", kind: "upload" },
    ];
    expect(buildCitations({ answer: "x [1]", citations: upload }).citations[0].kind).toBe("upload");
  });

  it("NFC-normalizes the answer text (VI recall safety)", () => {
    const nfd = "Việt".normalize("NFD");
    const nfc = nfd.normalize("NFC");
    const built = buildCitations({ answer: `${nfd} [1]`, citations: SOURCES });
    expect(built.text).toContain(nfc);
    expect(built.text).not.toContain(nfd);
  });

  it("is idempotent — re-running on its own output is a fixed point", () => {
    const once = buildCitations({ answer: "Real [1] fake [99].", citations: SOURCES });
    const twice = buildCitations({ answer: once.text, citations: SOURCES });
    expect(twice.text).toBe(once.text);
    expect(twice.citations).toEqual(once.citations);
  });
});
