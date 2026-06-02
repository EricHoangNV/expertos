import { cx } from "./cx";

export interface SkeletonProps {
  /**
   * Extra ds.css class(es) controlling the block's size/shape — the base `.skeleton`
   * shimmer is always applied, so no off-scale px ever leaks into markup.
   */
  className?: string;
}

/**
 * Loading placeholder (M12.9.4) — a shimmering block that stands in for content while it
 * loads (e.g. conversation-list rows). Purely decorative, so it is marked `aria-hidden`
 * and the surrounding region announces the loading state (`aria-busy`) for assistive tech.
 * Size/shape are supplied by a paired ds.css class, keeping all dimensions on the token scale.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <span className={cx("skeleton", className)} aria-hidden="true" />;
}
