import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state — renders the `.active` (ink-900 fill) treatment. */
  active?: boolean;
}

/**
 * Design-system selectable chip — renders ds.css `.chip`.
 * A real `<button>` so it stays keyboard-focusable and meets the hit-target rule.
 */
export function Chip({ active = false, type, className, ...rest }: ChipProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("chip", active && "active", className)}
      {...rest}
    />
  );
}
