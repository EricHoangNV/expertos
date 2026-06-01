import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type CiteVariant = "knowledge" | "upload";

export interface CiteProps extends HTMLAttributes<HTMLSpanElement> {
  /** Marker label (typically the citation index, e.g. `1`). */
  label: ReactNode;
  /** `knowledge` = crimson (published), `upload` = info-blue (user-provided). */
  variant?: CiteVariant;
  /**
   * The make-or-break guarantee: a `.cite` marker renders **only after** it
   * resolves to a real retrieved chunk. Defaults to `false` so an unresolved
   * marker is never flashed-then-removed — pass `resolved` explicitly once the
   * citation is known to resolve.
   */
  resolved?: boolean;
}

/**
 * Design-system inline citation marker — renders ds.css `.cite`
 * (`.cite.upload` for uploaded sources). Returns `null` until `resolved`.
 */
export function Cite({
  label,
  variant = "knowledge",
  resolved = false,
  className,
  ...rest
}: CiteProps) {
  if (!resolved) return null;
  return (
    <span
      className={cx("cite", variant === "upload" && "upload", className)}
      {...rest}
    >
      {label}
    </span>
  );
}
