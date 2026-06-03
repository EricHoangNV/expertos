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
   * Show the green trust badge (right-aligned) — set once the answer is complete and every emitted
   * citation resolved to a real chunk (M4.2 render-after-resolve). The badge attests that the answer's
   * citations resolve, NOT that its claims are independently fact-checked — hence the honest default
   * wording {@link verifiedLabel} of "Citations resolved" rather than "Verified".
   */
  verified?: boolean;
  /**
   * Text for the green trust badge. Defaults to "Citations resolved" — the honest claim the badge can
   * make (the citations resolve to real published chunks). The page passes a localized string.
   */
  verifiedLabel?: string;
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
  verifiedLabel = "Citations resolved",
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
            {verifiedLabel}
          </span>
        )}
      </div>
      <div className="msg-assistant-body">{children}</div>
    </div>
  );
}
