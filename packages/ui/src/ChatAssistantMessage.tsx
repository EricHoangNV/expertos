import type { ReactNode } from "react";
import { avatarInitials, avatarTone } from "./ChatConversationList";
import { cx } from "./cx";

export interface ChatAssistantMessageProps {
  /**
   * Display name of the expert whose voice rendered the answer (M2.2) → the avatar (initials + color)
   * and the bold author name. Null/undefined = the neutral voice (a generic "Assistant" author).
   */
  expertName?: string | null;
  /**
   * Show the "AI rendition" disclosure badge (M2.2) — true when the answer is rendered in an expert's
   * voice. The badge text plus the author name form the "AI rendition of [Expert]" attribution.
   */
  aiRendition?: boolean;
  /**
   * Small mono provenance label under the header, e.g. "grounded in published knowledge + your upload".
   * Omitted when the answer has no resolved sources yet (mid-stream / insufficient knowledge).
   */
  sourceLabel?: string;
  /**
   * Show the green "Verified" badge (right-aligned) — set once the answer is complete and grounded in
   * citations that resolved to real chunks (M4.2 render-after-resolve).
   */
  verified?: boolean;
  /** The answer body — prose + inline citations (M12.4.3) and the action bar / state cards (M12.4.4+). */
  children?: ReactNode;
}

/**
 * The assistant message container (M12.4.2) — a `.msg-assistant` block whose header carries the
 * expert avatar (initials on an expert-colored circle), the bold author name, the "AI rendition"
 * disclosure badge (M2.2), a mono source-provenance label, and a right-aligned green "Verified"
 * badge once the answer is grounded (M4.2). The answer prose, citations, and action bar render as
 * `children` in the body. Presentational only: the page resolves the expert name, computes the
 * source label from citation kinds, and flips `verified` on the completed `done` frame.
 */
export function ChatAssistantMessage({
  expertName,
  aiRendition = false,
  sourceLabel,
  verified = false,
  children,
}: ChatAssistantMessageProps) {
  const expert = expertName?.trim();
  const displayName = expert || "Assistant";

  return (
    <div className="msg-assistant">
      <div className="msg-assistant-head">
        <span
          className={cx("avatar", "msg-assistant-avatar", expert && `tone-${avatarTone(expert)}`)}
          aria-hidden="true"
        >
          {avatarInitials(expert ?? "Assistant")}
        </span>
        <span className="msg-assistant-name">{displayName}</span>
        {aiRendition && (
          <span
            className="badge badge-ink msg-assistant-rendition"
            aria-label={expert ? `AI rendition of ${expert}` : "AI rendition"}
          >
            AI rendition
          </span>
        )}
        {sourceLabel && <span className="msg-assistant-source muted">{sourceLabel}</span>}
        {verified && (
          <span className="badge badge-green msg-assistant-verified">
            <span className="dot" aria-hidden="true" />
            Verified
          </span>
        )}
      </div>
      <div className="msg-assistant-body">{children}</div>
    </div>
  );
}
