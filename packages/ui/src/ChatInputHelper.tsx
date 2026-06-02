import { cx } from "./cx";

export interface ChatInputHelperProps {
  /**
   * Remaining questions in the current window (threshold − used). When omitted or
   * `null` the right-hand counter is hidden (e.g. entitlements still loading) — the
   * left keyboard hint always renders. Clamped at 0 and NaN-guarded; rendered with a
   * singular/plural label.
   */
  questionsLeft?: number | null;
  /**
   * True on an unlimited plan — shows "Unlimited questions this month" on the right
   * instead of a remaining count. Takes precedence over `questionsLeft`.
   */
  unlimited?: boolean;
}

/**
 * The helper-text row under the input bar (M12.6.3, PRD §"UI Reference Spec" §5).
 * A small, muted two-column row: the keyboard hint on the left ("Enter to send ·
 * Shift + Enter for newline", describing the M12.6.4 behavior) and the remaining
 * monthly quota on the right ("N questions left this month", from `/me/entitlements`
 * — M6.1). Presentational only: the page resolves the remaining count. The right
 * counter is omitted until the quota resolves so it never flashes a placeholder.
 * Mounts inside the {@link ChatInputBar} `children` slot so it stays in the sticky bar.
 */
export function ChatInputHelper({ questionsLeft = null, unlimited = false }: ChatInputHelperProps) {
  let quotaText: string | null = null;
  if (unlimited) {
    quotaText = "Unlimited questions this month";
  } else if (questionsLeft != null && Number.isFinite(questionsLeft)) {
    const left = Math.max(0, Math.floor(questionsLeft));
    quotaText = `${left} ${left === 1 ? "question" : "questions"} left this month`;
  }

  return (
    <div className={cx("input-bar-help", "muted")}>
      <span className="input-bar-hint">Enter to send · Shift + Enter for newline</span>
      {quotaText && <span className="input-bar-quota">{quotaText}</span>}
    </div>
  );
}
