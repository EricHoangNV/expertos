import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { DEFAULT_LAYOUT_DIRECTION, layoutPanes, type LayoutDirection } from "./layout";

export interface ChatLayoutProps extends HTMLAttributes<HTMLDivElement> {
  /** Left conversation rail (M12.2) — rendered into `.chat-sidebar`; collapses < 900px. */
  sidebar?: ReactNode;
  /** Right sources rail (M12.5) — rendered into `.chat-rail`; collapses < 1280px. */
  rail?: ReactNode;
  /**
   * Layout direction (M12.1.3) — `studio` (default) keeps both panes in the grid;
   * `classic` drops the rail (→ sources drawer, M12.5.4); `focus` drops both the
   * sidebar and rail (→ overlays). A dropped pane's content is suppressed from the
   * grid here and handed to the drawer/overlay in the later tasks.
   */
  direction?: LayoutDirection;
}

/**
 * Three-pane chat shell (M12.1) — renders the ds.css `.chat-layout` grid
 * (sidebar 248px + main flex + sources rail 320px). The grid itself drops the
 * rail < 1280px and the sidebar < 900px (M12.1.1); on top of that the active
 * {@link LayoutDirection} (M12.1.3) decides which panes belong in the grid at all
 * vs. reopen as overlays/drawers. Each region is only emitted when content is
 * supplied AND the direction keeps it, so `focus` / `classic` drop a pane even
 * when content is passed. Children are the chat column (`.chat-main`).
 */
export function ChatLayout({
  sidebar,
  rail,
  direction = DEFAULT_LAYOUT_DIRECTION,
  className,
  children,
  ...rest
}: ChatLayoutProps) {
  const panes = layoutPanes(direction);
  const showSidebar = sidebar != null && panes.sidebar;
  const showRail = rail != null && panes.rail;
  return (
    <div className={cx("chat-layout", `chat-layout-${direction}`, className)} {...rest}>
      {showSidebar && <aside className="chat-sidebar">{sidebar}</aside>}
      <div className="chat-main">{children}</div>
      {showRail && <aside className="chat-rail">{rail}</aside>}
    </div>
  );
}
