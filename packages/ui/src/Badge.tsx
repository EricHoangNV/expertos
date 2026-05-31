import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeTone = "red" | "green" | "amber" | "info" | "ink";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Design-system status badge — renders ds.css `.badge` + tone classes. */
export function Badge({ tone = "ink", className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("badge", `badge-${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}
