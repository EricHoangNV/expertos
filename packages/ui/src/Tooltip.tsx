import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TooltipProps {
  /** Accessible name for the trigger describing the tooltip's purpose (e.g. "About the score floor"). */
  label: string;
  /** Rich content revealed on hover / keyboard focus. */
  children: ReactNode;
  /** Extra class on the wrapper. */
  className?: string;
}

/**
 * Design-system info tooltip — a small `(i)` trigger that reveals `children` on hover or keyboard
 * focus via CSS `:hover`/`:focus-within` (no JS). Renders ds.css `.tooltip`. The trigger is a
 * focusable `<span>` (not a `<button>`) so it stays valid HTML when nested inside a `<label>` — e.g.
 * passed through a {@link Field} `label` prop.
 *
 * The wrapper + bubble are `<div>`s (not `<span>`s) because `children` can be rich block content —
 * the admin score-floor tooltip nests a `<table>`, which is invalid (and warns in React) inside a
 * `<span>`. Both carry `display`-driven layout in ds.css (`inline-flex` wrapper, absolutely-positioned
 * bubble), so the block element is visually identical to a span while keeping the markup valid.
 */
export function Tooltip({ label, children, className }: TooltipProps) {
  return (
    <div className={cx("tooltip", className)}>
      <span className="tooltip-trigger" tabIndex={0} role="note" aria-label={label}>
        i
      </span>
      <div className="tooltip-bubble" role="tooltip">
        {children}
      </div>
    </div>
  );
}
