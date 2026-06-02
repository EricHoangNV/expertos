import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeTone = "red" | "green" | "amber" | "info" | "ink";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Render a leading status dot (used by the concierge review header badges, M13.6.3). */
  dot?: boolean;
}

/** Design-system status badge — renders ds.css `.badge` + tone classes. */
export function Badge({ tone = "ink", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("badge", `badge-${tone}`, className)} {...rest}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}
