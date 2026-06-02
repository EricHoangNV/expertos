import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface ChatLayoutProps extends HTMLAttributes<HTMLDivElement> {
  /** Left conversation rail (M12.2) — rendered into `.chat-sidebar`; collapses < 900px. */
  sidebar?: ReactNode;
  /** Right sources rail (M12.5) — rendered into `.chat-rail`; collapses < 1280px. */
  rail?: ReactNode;
}

/**
 * Three-pane chat shell (M12.1) — renders the ds.css `.chat-layout` grid
 * (sidebar 248px + main flex + sources rail 320px). The grid itself drops the
 * rail < 1280px and the sidebar < 900px (M12.1.1); the hidden panes reopen as
 * overlays/drawers in later tasks. Each region is only emitted when content is
 * supplied, so `focus` / `classic` layout directions (M12.1.3) drop a pane by
 * passing `undefined`. Children are the chat column (`.chat-main`).
 */
export function ChatLayout({ sidebar, rail, className, children, ...rest }: ChatLayoutProps) {
  return (
    <div className={cx("chat-layout", className)} {...rest}>
      {sidebar != null && <aside className="chat-sidebar">{sidebar}</aside>}
      <div className="chat-main">{children}</div>
      {rail != null && <aside className="chat-rail">{rail}</aside>}
    </div>
  );
}
