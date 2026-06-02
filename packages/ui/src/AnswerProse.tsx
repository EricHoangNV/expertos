import type { ReactNode } from "react";
import { Cite, type CiteVariant } from "./Cite";

/** A single `[n]` citation marker in answer prose. */
const MARKER = /\[(\d+)\]/g;

/** A resolved citation for the prose: the marker ordinal + which color treatment it gets. */
export interface AnswerProseCitation {
  /** The `[n]` ordinal this citation backs. */
  ordinal: number;
  /** `knowledge` = crimson (published) `.cite`; `upload` = info-blue `.cite.upload`. */
  variant: CiteVariant;
}

export interface AnswerProseProps {
  /** The assistant answer text, with `[n]` markers inline. */
  content: string;
  /**
   * Resolved citations: a `[n]` marker becomes a live `.cite` chip ONLY when its ordinal appears
   * here (M4.2 render-after-resolve — a hallucinated `[9]` that points nowhere stays plain text).
   */
  citations: ReadonlyArray<AnswerProseCitation>;
  /**
   * When true, resolved markers become interactive `.cite` chips; when false (mid-stream) the prose
   * renders verbatim so a marker is never flashed before it resolves.
   */
  interactive: boolean;
  /** Click-to-passage (M4.2): invoked with the marker ordinal when a `.cite` chip is activated. */
  onCite?: (ordinal: number) => void;
}

/**
 * The answer prose of an assistant turn (M12.4.3): body text with its `[n]` markers turned into
 * inline `.cite` chips — crimson for published knowledge, info-blue (`.cite.upload`) for uploaded
 * sources. The make-or-break guarantee is render-after-resolve: until `interactive` is true and at
 * least one citation has resolved, the text renders verbatim (no chips); once resolved, only markers
 * that map to a real citation become chips, and an unresolvable bracketed number is left as plain
 * text so a hallucinated `[9]` can never masquerade as a verified source. Activating a chip invokes
 * `onCite` for click-to-passage. Presentational + pure — the sources list lives elsewhere (the rail,
 * M12.5; or {@link AnswerView}'s drawer fallback).
 */
export function AnswerProse({ content, citations, interactive, onCite }: AnswerProseProps) {
  const resolved = interactive && citations.length > 0;
  if (!resolved) return <p>{content}</p>;

  const byOrdinal = new Map<number, CiteVariant>();
  for (const citation of citations) byOrdinal.set(citation.ordinal, citation.variant);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of content.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const ordinal = Number(match[1]);
    const variant = byOrdinal.get(ordinal);
    if (start > cursor) nodes.push(content.slice(cursor, start));
    if (variant) {
      nodes.push(
        <Cite
          key={`cite-${key++}`}
          label={ordinal}
          resolved
          variant={variant}
          role="button"
          tabIndex={0}
          aria-label={`Source ${ordinal}`}
          onClick={() => onCite?.(ordinal)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onCite?.(ordinal);
            }
          }}
        />,
      );
    } else {
      nodes.push(match[0]);
    }
    cursor = start + match[0].length;
  }
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return <p>{nodes}</p>;
}
