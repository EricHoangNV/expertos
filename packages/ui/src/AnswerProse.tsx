import { Fragment, type ReactNode } from "react";
import { Cite, type CiteVariant } from "./Cite";

/** A single `[n]` citation marker in answer prose. */
const MARKER = /\[(\d+)\]/g;
/** A `**bold**` inline span (non-greedy so `**a** **b**` stays two spans). */
const BOLD = /\*\*(.+?)\*\*/g;
/** A numbered-list line: `1. item` (the marker must be followed by a space). */
const ORDERED = /^\s*\d+\.\s+(.*)$/;
/** A bullet-list line: `- item` / `* item` (the space rules out `**bold**` openers). */
const UNORDERED = /^\s*[-*]\s+(.*)$/;

/** A resolved citation for the prose: the marker ordinal + which color treatment it gets. */
export interface AnswerProseCitation {
  /** The `[n]` ordinal this citation backs. */
  ordinal: number;
  /** `knowledge` = crimson (published) `.cite`; `upload` = info-blue `.cite.upload`. */
  variant: CiteVariant;
}

export interface AnswerProseProps {
  /** The assistant answer text — markdown (paragraphs, numbered/bullet lists, `**bold**`) with `[n]` markers inline. */
  content: string;
  /**
   * Resolved citations: a `[n]` marker becomes a live `.cite` chip ONLY when its ordinal appears
   * here (M4.2 render-after-resolve — a hallucinated `[9]` that points nowhere stays plain text).
   */
  citations: ReadonlyArray<AnswerProseCitation>;
  /**
   * When true, resolved markers become interactive `.cite` chips; when false (mid-stream) the prose's
   * `[n]` markers render verbatim so a marker is never flashed before it resolves. Markdown structure
   * (lists, bold) still renders either way — only the chip promotion waits on resolve.
   */
  interactive: boolean;
  /** Click-to-passage (M4.2): invoked with the marker ordinal when a `.cite` chip is activated. */
  onCite?: (ordinal: number) => void;
}

/** A parsed block of answer prose: a paragraph (one or more soft-wrapped lines) or a list. */
type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ol" | "ul"; items: string[] };

/** Split the answer into paragraph / list blocks on newlines (markdown's block grammar, minimal). */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\s+$/u, "");
    if (line.trim() === "") {
      // A blank line ends a paragraph but NOT a list: models often separate list items with blank
      // lines (a "loose" list), and those items belong to one list so its numbering counts up. The
      // list is closed instead by the next non-list line (or end of input).
      flushPara();
      continue;
    }
    const ol = ORDERED.exec(line);
    const ul = ol ? null : UNORDERED.exec(line);
    if (ol) {
      flushPara();
      if (list?.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(ol[1]);
    } else if (ul) {
      flushPara();
      if (list?.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ul[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** A monotonic key source so every emitted node across the tree gets a stable, unique React key. */
interface InlineCtx {
  byOrdinal: Map<number, CiteVariant> | null;
  onCite?: (ordinal: number) => void;
  nextKey: () => string;
}

/** Turn the resolved `[n]` markers in a run of text into `.cite` chips; leave the rest as text. */
function renderCitations(text: string, ctx: InlineCtx): ReactNode[] {
  if (!ctx.byOrdinal) return [text];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const ordinal = Number(match[1]);
    const variant = ctx.byOrdinal.get(ordinal);
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (variant) {
      nodes.push(
        <Cite
          key={ctx.nextKey()}
          label={ordinal}
          resolved
          variant={variant}
          role="button"
          tabIndex={0}
          aria-label={`Source ${ordinal}`}
          onClick={() => ctx.onCite?.(ordinal)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              ctx.onCite?.(ordinal);
            }
          }}
        />,
      );
    } else {
      // Unresolvable bracketed number: keep it as plain text so a hallucinated `[9]` is never a chip.
      nodes.push(match[0]);
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Render one line of inline markdown: `**bold**` spans wrapping `<strong>`, citations within each run. */
function renderInline(text: string, ctx: InlineCtx): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BOLD)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(...renderCitations(text.slice(cursor, start), ctx));
    nodes.push(<strong key={ctx.nextKey()}>{renderCitations(match[1], ctx)}</strong>);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(...renderCitations(text.slice(cursor), ctx));
  return nodes;
}

/**
 * The answer prose of an assistant turn (M12.4.3): markdown body text — paragraphs, numbered and
 * bullet lists, and `**bold**` — with its `[n]` markers turned into inline `.cite` chips (crimson for
 * published knowledge, info-blue `.cite.upload` for uploads). The make-or-break guarantee is
 * render-after-resolve: until `interactive` is true and at least one citation has resolved, the `[n]`
 * markers render verbatim (no chips); once resolved, only markers that map to a real citation become
 * chips and an unresolvable bracketed number is left as plain text, so a hallucinated `[9]` can never
 * masquerade as a verified source. Markdown structure renders either way (it carries no trust claim).
 * Activating a chip invokes `onCite` for click-to-passage. Presentational + pure — the sources list
 * lives elsewhere (the rail, M12.5; or {@link AnswerView}'s drawer fallback).
 */
export function AnswerProse({ content, citations, interactive, onCite }: AnswerProseProps) {
  const resolved = interactive && citations.length > 0;
  const byOrdinal = resolved ? new Map<number, CiteVariant>() : null;
  if (byOrdinal) for (const c of citations) byOrdinal.set(c.ordinal, c.variant);

  let counter = 0;
  const ctx: InlineCtx = { byOrdinal, onCite, nextKey: () => `n${counter++}` };

  return (
    <div className="answer-prose">
      {parseBlocks(content).map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={`b${i}`}>
              {block.lines.map((line, li) => (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {renderInline(line, ctx)}
                </Fragment>
              ))}
            </p>
          );
        }
        const Tag = block.kind;
        return (
          <Tag key={`b${i}`}>
            {block.items.map((item, li) => (
              <li key={li}>{renderInline(item, ctx)}</li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
