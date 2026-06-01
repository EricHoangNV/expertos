import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type StatTrend = "up" | "down";

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  /** Metric label (`.k` — mono uppercase). */
  label: ReactNode;
  /** Metric value (`.v` — display face). */
  value: ReactNode;
  /** Optional delta line (`.d`). */
  delta?: ReactNode;
  /** Tints the delta green (`up`) or crimson (`down`). */
  trend?: StatTrend;
}

/** Design-system KPI stat card — renders ds.css `.stat`. */
export function Stat({
  label,
  value,
  delta,
  trend,
  className,
  ...rest
}: StatProps) {
  return (
    <div className={cx("stat", className)} {...rest}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {delta != null && (
        <div className={cx("d", trend === "up" && "up", trend === "down" && "down")}>
          {delta}
        </div>
      )}
    </div>
  );
}
