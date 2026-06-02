import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** Which ds.css fill a stacked-bar segment uses (grounded = crimson, lowconf = red, insufficient = light). */
export type StackedBarTone = "grounded" | "lowconf" | "insufficient";

/** One segment of a {@link StackedBar}: a relative weight + its fill tone. */
export interface StackedBarSegment {
  /** Relative weight; non-finite or non-positive values contribute nothing and aren't rendered. */
  value: number;
  /** The ds.css fill tone (`.seg-grounded` / `.seg-lowconf` / `.seg-insufficient`). */
  tone: StackedBarTone;
  /** Accessible label / hover title for the segment. */
  label?: string;
}

export interface StackedBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Segments rendered left-to-right; widths are proportional to each value's share of the total. */
  segments: StackedBarSegment[];
}

/**
 * Design-system stacked proportional bar — renders ds.css `.progress-bar-stacked` (M13.2.3). Each
 * segment's width is its share of the summed (finite, positive) weights; non-positive segments are
 * dropped, and an all-zero set renders an empty track (no division → never NaN).
 */
export function StackedBar({ segments, className, ...rest }: StackedBarProps) {
  const positive = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className={cx("progress-bar-stacked", className)} {...rest}>
      {positive.map((s, i) => (
        <i
          key={i}
          className={cx(`seg-${s.tone}`)}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={s.label}
          aria-label={s.label}
        />
      ))}
    </div>
  );
}
