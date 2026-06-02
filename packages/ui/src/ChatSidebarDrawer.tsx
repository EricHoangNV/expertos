import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

export interface ChatSidebarDrawerProps {
  /** Whether the drawer is shown. When false the component renders nothing. */
  open: boolean;
  /** Dismiss handler — fired by the backdrop and Escape (the hosted sidebar's own X also closes). */
  onClose: () => void;
  /**
   * The sidebar content (M12.2) — the same {@link ChatSidebar} the persistent rail
   * hosts. Mounted unchanged so the overlay and the grid sidebar never drift; the
   * sidebar's own collapse (X) affordance doubles as the in-panel close.
   */
  children?: ReactNode;
  /** Accessible dialog label (the slide-over has no visible title of its own). */
  title?: string;
  className?: string;
}

/**
 * Chat sidebar drawer (M12.9.1) — the left-anchored slide-over presentation of the
 * conversation sidebar for when the persistent `.chat-sidebar` pane is not in the grid:
 * a narrow viewport (< 900px, ds.css M12.1.1 drops it) or the `focus` layout direction
 * (M12.1.3 drops it). It hosts the same {@link ChatSidebar} content as the grid pane so
 * the two never diverge — only the chrome differs: a dimmed backdrop and a left-edge
 * slide-in panel.
 *
 * Presentational and controlled — the chat page owns the open state and decides when the
 * sidebar is overlay vs. in-grid (mirroring the {@link SourcesDrawer} fallback for the
 * sources rail). Dismissable by clicking the backdrop, pressing Escape while focus is
 * inside the panel, or the hosted sidebar's collapse button (no document-level listener,
 * so the component stays a pure function).
 */
export function ChatSidebarDrawer({
  open,
  onClose,
  children,
  title = "Navigation",
  className,
}: ChatSidebarDrawerProps) {
  if (!open) return null;
  return (
    <div className="chat-sidebar-drawer-backdrop" onClick={onClose}>
      <aside
        className={cx("chat-sidebar-drawer", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Keep clicks inside the panel from bubbling to the backdrop (which dismisses).
        onClick={(e: MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {children}
      </aside>
    </div>
  );
}
