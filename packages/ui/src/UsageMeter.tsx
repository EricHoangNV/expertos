import type { HTMLAttributes, ReactNode } from "react";
import { Bar } from "./Bar";
import { cx } from "./cx";

/** Fraction of the threshold at which the meter turns amber even before the wall is reached. */
const DEFAULT_WARN_RATIO = 0.8;

export interface UsageMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Feature label (e.g. "Questions"). */
  label: ReactNode;
  /** Count consumed in the current window. */
  used: number;
  /** Hard cap for the window, or `null`/omitted when there is no hard cap. */
  limit?: number | null;
  /**
   * Fair-use soft threshold (M6.3) — the wall the meter measures against when there is no hard cap.
   * Past it the answer degrades to a cheaper model rather than blocking, so the meter warns but never
   * reads as "full/blocked".
   */
  softLimit?: number | null;
  /** Turn amber at this fraction of the threshold (default 0.8). */
  warnRatio?: number;
}

/**
 * The transparent usage indicator (M6.3, PRD §"Paywall, Entitlements & Feature Gating"): a labelled
 * `.bar` quota meter so the wall is never a surprise mid-task. It measures `used` against the hard
 * `limit` when there is one, else against the fair-use `softLimit`; it turns amber (`.bar.warn`) when
 * usage nears that threshold, or — for a fair-use plan — once the soft threshold is passed (degrade,
 * don't block). A feature with neither threshold reads "Unlimited" with no fill.
 */
export function UsageMeter({
  label,
  used,
  limit = null,
  softLimit = null,
  warnRatio = DEFAULT_WARN_RATIO,
  className,
  ...rest
}: UsageMeterProps) {
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0;
  // The hard cap wins when present; otherwise the fair-use soft threshold is the wall we draw.
  const threshold = limit ?? softLimit;
  const overSoft = limit === null && softLimit !== null && safeUsed > softLimit;

  let countText: string;
  let pct = 0;
  let warn = false;
  if (threshold === null || threshold <= 0) {
    countText = `${safeUsed} used · Unlimited`;
  } else {
    pct = Math.min(100, (safeUsed / threshold) * 100);
    warn = overSoft || safeUsed / threshold >= warnRatio;
    // No hard cap → the threshold is a fair-use line, not a block: never present it as a remaining wall.
    countText =
      limit === null
        ? `${safeUsed} used · fair-use ${softLimit}`
        : `${safeUsed} / ${limit}`;
  }

  return (
    <div className={cx("meter", warn && "is-warn", className)} {...rest}>
      <div className="meter-head">
        <span className="label">{label}</span>
        <span className="meter-count">{countText}</span>
      </div>
      <Bar value={pct} warn={warn} />
    </div>
  );
}
