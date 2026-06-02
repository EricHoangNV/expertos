import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface SourcesRailProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Header region (M12.5.2) — the "SOURCES" `.label` + passage count + the
   * "all citations resolved" `.trust-badge` mount here. Rendered above the cards.
   */
  header?: ReactNode;
  /**
   * Source cards (M12.5.3) — the numbered, color-distinguished citation cards for
   * the currently selected / latest answer. When omitted the rail shows its empty
   * state instead, so the panel is never a blank column.
   */
  children?: ReactNode;
  /** Empty-state copy shown when no answer has resolved sources yet. */
  emptyLabel?: string;
}

/**
 * Sources rail container (M12.5.1) — the 320px sticky right panel of the chat
 * `.chat-layout` grid: a scrollable column with a `--line` left border that shows
 * the cited sources for the currently selected / latest answer. This is the shell
 * only; the header (M12.5.2) mounts via `header` and the numbered source cards
 * (M12.5.3) mount as `children`. With neither, it renders a muted empty state so
 * the panel is never a blank gap. Presentational — all data wiring lives in the
 * chat page; the responsive collapse (→ drawer < 1280px, M12.5.4) is handled by
 * the `.chat-rail` grid area, not here.
 */
export function SourcesRail({
  header,
  children,
  emptyLabel = "Sources for an answer will appear here once you ask a question.",
  className,
  ...rest
}: SourcesRailProps) {
  const hasContent = children != null;
  return (
    <div className={cx("sources-rail", className)} {...rest}>
      {header != null && <div className="sources-rail-head">{header}</div>}
      {hasContent ? (
        <div className="sources-rail-body">{children}</div>
      ) : (
        <p className="sources-rail-empty muted">{emptyLabel}</p>
      )}
    </div>
  );
}
