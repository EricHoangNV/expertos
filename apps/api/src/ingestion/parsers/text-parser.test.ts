import { TextParser } from "./text-parser";

describe("TextParser", () => {
  const parser = new TextParser();

  it("declares plain-text and markdown content types", () => {
    expect(parser.contentTypes).toContain("text/plain");
    expect(parser.contentTypes).toContain("text/markdown");
    expect(parser.contentTypes).toContain("md");
  });

  it("parses a string, normalizing CRLF and trimming", async () => {
    const out = await parser.parse("  # Title\r\n\r\nBody line\r\n  ");
    expect(out.text).toBe("# Title\n\nBody line");
  });

  it("parses a Buffer as UTF-8", async () => {
    const out = await parser.parse(Buffer.from("héllo wörld", "utf8"));
    expect(out.text).toBe("héllo wörld");
  });

  it("keeps Markdown structure intact", async () => {
    const out = await parser.parse("- one\n- two");
    expect(out.text).toBe("- one\n- two");
  });
});
