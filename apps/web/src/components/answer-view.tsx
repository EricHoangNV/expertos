"use client";

import { useCallback, useRef, useState } from "react";
import { AnswerProse, Cite } from "@expertos/ui";
import type { ChatCitationDto } from "@expertos/shared";

interface AnswerViewProps {
  content: string;
  citations: ChatCitationDto[];
  /**
   * When true, `[n]` markers become interactive `.cite` chips and the sources drawer is shown
   * (M4.2 render-after-resolve). The chat page passes `message.done` so markers stay non-interactive
   * mid-stream; the history detail view always passes `true` (a persisted answer is final).
   */
  interactive: boolean;
  /**
   * Controls the inline sources drawer visibility (M12.4.4). When provided, the drawer is shown only
   * while `true` — driven by the action-bar "View sources (N)" toggle. When omitted (history view),
   * the drawer always shows once resolved, preserving the M4.2 default.
   */
  sourcesOpen?: boolean;
  /**
   * Click-to-passage hook to the host's sources surface. When provided (the chat page, whose sources
   * live in the page-level rail/drawer rather than this inline list), an inline marker click also
   * forwards its ordinal here so the host can open + highlight + scroll to the matching source. The
   * inline drawer's own highlight still runs, so the history view (which omits this) is unchanged.
   */
  onCite?: (ordinal: number) => void;
}

/**
 * One assistant answer: the prose with inline citation markers plus a sources drawer (M4.2). The
 * drawer lists each resolved source with its quote and provenance (`document_version_id` for
 * knowledge, the file/sheet/cell label for an upload); clicking an inline marker highlights and
 * scrolls to the matching source row (click-to-passage). Shared by the live chat turn and the
 * history transcript so the two never drift.
 */
export function AnswerView({ content, citations, interactive, sourcesOpen, onCite }: AnswerViewProps) {
  const [activeOrdinal, setActiveOrdinal] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const focusSource = useCallback(
    (ordinal: number) => {
      setActiveOrdinal(ordinal);
      rowRefs.current.get(ordinal)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // Forward to the host's sources surface (chat rail/drawer); a no-op in the history view.
      onCite?.(ordinal);
    },
    [onCite],
  );

  // Show the drawer once citations resolved (M4.2), but honor the action-bar toggle when the chat
  // page controls it (M12.4.4): `sourcesOpen === undefined` keeps the always-show history default.
  const resolved = interactive && citations.length > 0 && sourcesOpen !== false;

  return (
    <>
      <AnswerProse
        content={content}
        citations={citations.map((c) => ({ ordinal: c.ordinal, variant: c.kind }))}
        interactive={interactive}
        onCite={focusSource}
      />
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
