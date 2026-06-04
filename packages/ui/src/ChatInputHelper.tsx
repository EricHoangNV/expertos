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
  /** Left keyboard hint (i18n M13). Defaults to English. */
  hint?: string;
  /** Right-hand text for an unlimited plan (i18n M13). Defaults to English. */
  unlimitedLabel?: string;
  /**
   * Right-hand remaining-count template with a `{count}` token (i18n M13). Defaults to
   * English plural. `questionsLeftLabelOne` overrides it when exactly one remains, so
   * languages with a singular form stay correct (others can pass the same string).
   */
  questionsLeftLabel?: string;
  /** Singular `{count}` template used when exactly one question remains (i18n M13). */
  questionsLeftLabelOne?: string;
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
export function ChatInputHelper({
  questionsLeft = null,
  unlimited = false,
  hint = "Enter to send · Shift + Enter for newline",
  unlimitedLabel = "Unlimited questions this month",
  questionsLeftLabel = "{count} questions left this month",
  questionsLeftLabelOne = "{count} question left this month",
}: ChatInputHelperProps) {
  let quotaText: string | null = null;
  if (unlimited) {
    quotaText = unlimitedLabel;
  } else if (questionsLeft != null && Number.isFinite(questionsLeft)) {
    const left = Math.max(0, Math.floor(questionsLeft));
    const template = left === 1 ? questionsLeftLabelOne : questionsLeftLabel;
    quotaText = template.replace("{count}", String(left));
  }

  return (
    <div className={cx("input-bar-help", "muted")}>
      <span className="input-bar-hint">{hint}</span>
      {quotaText && <span className="input-bar-quota">{quotaText}</span>}
    </div>
  );
}
