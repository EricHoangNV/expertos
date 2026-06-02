import { Bar } from "./Bar";
import { cx } from "./cx";

/** Fraction of the threshold at which the meter turns amber even before the wall is reached. */
const DEFAULT_WARN_RATIO = 0.8;

export interface ChatUsageMeterProps {
  /** Questions consumed in the current window. */
  used: number;
  /** Hard cap for the window, or `null`/omitted when there is no hard cap. */
  limit?: number | null;
  /**
   * Fair-use soft threshold (M6.3) — the wall the meter measures against when there is no hard cap.
   * Past it the answer degrades to a cheaper model rather than blocking, so the meter warns but never
   * reads as "full/blocked".
   */
  softLimit?: number | null;
  /** Plan name for the badge (e.g. "Plus"). */
  planName: string;
  /**
   * Target for the crimson "Upgrade →" link; when omitted (e.g. the user is on the top plan) no
   * link renders, so the meter never becomes a dead end.
   */
  upgradeHref?: string;
  /** Turn amber at this fraction of the threshold (default 0.8). */
  warnRatio?: number;
}

/**
 * The sidebar-bottom usage meter (M12.2.4, PRD §"UI Reference Spec" §6) — the dark-rail counterpart
 * to {@link UsageMeter}: a "questions this month" label + "N / M" count over a crimson `.bar`
 * (amber `.bar.warn` near the cap), then a plan `.label` badge and a crimson "Upgrade →" link.
 * It measures `used` against the hard `limit` when there is one, else against the fair-use
 * `softLimit` (degrade, don't block); with neither it reads "Unlimited" with no fill. Presentational
 * only — the chat page wires it to `/me/entitlements` (M6.1) and resolves the plan/quota.
 */
export function ChatUsageMeter({
  used,
  limit = null,
  softLimit = null,
  planName,
  upgradeHref,
  warnRatio = DEFAULT_WARN_RATIO,
}: ChatUsageMeterProps) {
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0;
  // The hard cap wins when present; otherwise the fair-use soft threshold is the wall we draw.
  const threshold = limit ?? softLimit;
  const overSoft = limit === null && softLimit !== null && safeUsed > softLimit;

  let countText: string;
  let pct = 0;
  let warn = false;
  if (threshold === null || threshold <= 0) {
    countText = `${safeUsed} · Unlimited`;
  } else {
    pct = Math.min(100, (safeUsed / threshold) * 100);
    warn = overSoft || safeUsed / threshold >= warnRatio;
    countText = `${safeUsed} / ${threshold}`;
  }

  return (
    <div className={cx("sidebar-usage", warn && "is-warn")}>
      <div className="sidebar-usage-head">
        <span className="muted">questions this month</span>
        <span className="sidebar-usage-count">{countText}</span>
      </div>
      <Bar value={pct} warn={warn} />
      <div className="sidebar-usage-foot">
        <span className="label">{planName}</span>
        {upgradeHref && (
          <a className="sidebar-usage-upgrade" href={upgradeHref}>
            Upgrade →
          </a>
        )}
      </div>
    </div>
  );
}
