import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChatStateNoticeTone = "amber" | "info";

export interface ChatStateNoticeProps {
  /**
   * Semantic tone → the tone-matched `.badge` label and the card accent. `amber` for the
   * insufficient-knowledge and high-stakes disclaimer cards; `info` for the fair-use degrade note.
   */
  tone: ChatStateNoticeTone;
  /** Short badge label at the head of the notice (e.g. "Limited knowledge", "Important", "Fair-use mode"). */
  label: string;
  /**
   * `card` (default) → a full `.msg-notice` card (tone-tinted bg + matching badge + body). `note` →
   * a compact `.msg-note` row (badge + muted text inline), the "subtle info badge" used for degrade.
   */
  variant?: "card" | "note";
  /** Optional display-font heading inside the card (above the body). Ignored in the `note` variant. */
  heading?: ReactNode;
  /** Body / description text — the rephrase-or-book suggestion, the legal disclaimer, the degrade note. */
  children?: ReactNode;
}

/**
 * The answer-state notice (M12.4.6) — the design-system card/badge surface for the three
 * post-answer states the chat can surface under an assistant turn (PRD §"State Mapping"):
 *  - insufficient knowledge → an `amber` card with a rephrase/book suggestion;
 *  - high-stakes topic → an `amber` card carrying the legal disclaimer (NT.4);
 *  - fair-use degrade → a subtle `info` `note` (badge + muted text about the lighter model, M6.3).
 *
 * Presentational only: the page decides which states fired (from the `done` chat frame) and passes
 * the copy as `children`. The badge tone always matches the card accent so status reads consistently
 * (Design System: amber = warning/disclaimer, info = degrade/processing).
 */
export function ChatStateNotice({
  tone,
  label,
  variant = "card",
  heading,
  children,
}: ChatStateNoticeProps) {
  if (variant === "note") {
    return (
      <div className="msg-note">
        <span className={cx("badge", `badge-${tone}`)}>{label}</span>
        {children != null && <span className="muted">{children}</span>}
      </div>
    );
  }

  return (
    <div className={cx("msg-notice", `tone-${tone}`)}>
      <div className="msg-notice-head">
        <span className={cx("badge", `badge-${tone}`)}>{label}</span>
        {heading != null && <p className="msg-notice-title">{heading}</p>}
      </div>
      {children != null && <p className="msg-notice-body">{children}</p>}
    </div>
  );
}
