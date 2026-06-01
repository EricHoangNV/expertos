"use client";

import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Cite } from "@expertos/ui";
import type { ChatCitationDto } from "@expertos/shared";

/** Single `[n]` citation marker in answer prose. */
const MARKER = /\[(\d+)\]/g;

/**
 * Renders an assistant answer with its `[n]` markers turned into clickable `.cite` chips — but
 * only when the marker resolves to a real citation (M4.2 render-after-resolve: a marker is never a
 * live `.cite` when it points nowhere). Clicking a marker invokes `onCite` for click-to-passage. An
 * unresolvable bracketed number is left as plain text so a hallucinated `[9]` can never masquerade
 * as a verified source.
 */
function renderAnswer(
  content: string,
  byOrdinal: Map<number, ChatCitationDto>,
  onCite: (ordinal: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of content.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const ordinal = Number(match[1]);
    const citation = byOrdinal.get(ordinal);
    if (start > cursor) nodes.push(content.slice(cursor, start));
    if (citation) {
      nodes.push(
        <Cite
          key={`cite-${key++}`}
          label={ordinal}
          resolved
          variant={citation.kind}
          role="button"
          tabIndex={0}
          aria-label={`Source ${ordinal}`}
          onClick={() => onCite(ordinal)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onCite(ordinal);
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
  return nodes;
}

interface AnswerViewProps {
  content: string;
  citations: ChatCitationDto[];
  /**
   * When true, `[n]` markers become interactive `.cite` chips and the sources drawer is shown
   * (M4.2 render-after-resolve). The chat page passes `message.done` so markers stay non-interactive
   * mid-stream; the history detail view always passes `true` (a persisted answer is final).
   */
  interactive: boolean;
}

/**
 * One assistant answer: the prose with inline citation markers plus a sources drawer (M4.2). The
 * drawer lists each resolved source with its quote and provenance (`document_version_id` for
 * knowledge, the file/sheet/cell label for an upload); clicking an inline marker highlights and
 * scrolls to the matching source row (click-to-passage). Shared by the live chat turn and the
 * history transcript so the two never drift.
 */
export function AnswerView({ content, citations, interactive }: AnswerViewProps) {
  const [activeOrdinal, setActiveOrdinal] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const byOrdinal = useMemo(() => {
    const map = new Map<number, ChatCitationDto>();
    for (const citation of citations) map.set(citation.ordinal, citation);
    return map;
  }, [citations]);

  const focusSource = useCallback((ordinal: number) => {
    setActiveOrdinal(ordinal);
    rowRefs.current.get(ordinal)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const resolved = interactive && citations.length > 0;

  return (
    <>
      <p>{resolved ? renderAnswer(content, byOrdinal, focusSource) : content}</p>
      {resolved && (
        <div className="sources">
          <span className="label">Sources</span>
          {citations.map((citation) => (
            <div
              key={citation.ordinal}
              ref={(el) => {
                if (el) rowRefs.current.set(citation.ordinal, el);
              }}
              className={citation.ordinal === activeOrdinal ? "source active" : "source"}
            >
              <Cite label={citation.ordinal} resolved variant={citation.kind} />
              <div className="source-body">
                {citation.quote && <span className="source-quote">{citation.quote}</span>}
                <span className="source-prov">
                  source:{" "}
                  {citation.kind === "upload"
                    ? (citation.sourceLabel ?? "uploaded file")
                    : citation.documentVersionId}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
