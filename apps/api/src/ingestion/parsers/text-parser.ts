import { type Parser, type ParsedDocument, toText } from "../parser";

/**
 * Plain-text and Markdown parser. Markdown is kept as-is (its structure is useful
 * context for retrieval and citation quotes); only line endings are normalized.
 */
export class TextParser implements Parser {
  readonly contentTypes = [
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "txt",
    "md",
    "markdown",
  ] as const;

  parse(raw: Buffer | string): Promise<ParsedDocument> {
    const text = toText(raw).replace(/\r\n?/g, "\n").trim();
    return Promise.resolve({ text });
  }
}
