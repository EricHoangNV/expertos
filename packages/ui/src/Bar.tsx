import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface BarProps extends HTMLAttributes<HTMLDivElement> {
  /** Fill percentage (0–100); clamped and NaN/Infinity-guarded. */
  value: number;
  /** Render the amber `.bar.warn` treatment (e.g. fair-use threshold). */
  warn?: boolean;
}

/** Design-system quota / progress meter — renders ds.css `.bar`. */
export function Bar({ value, warn = false, className, ...rest }: BarProps) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className={cx("bar", warn && "warn", className)} {...rest}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
