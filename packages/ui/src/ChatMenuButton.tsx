import { cx } from "./cx";

export interface ChatMenuButtonProps {
  /** Open the sidebar overlay (M12.9.1). */
  onOpen: () => void;
  className?: string;
}

/**
 * Topbar navigation toggle (M12.9.1) — the hamburger button that opens the sidebar
 * slide-over ({@link ChatSidebarDrawer}) when the persistent sidebar pane is not in the
 * grid (narrow viewport < 900px, or the `focus` layout direction). A `.btn-subtle`
 * icon button that the chat page mounts in the topbar's leading slot only while the
 * sidebar is an overlay, so it never becomes a dead control next to a visible sidebar.
 * Presentational only — the page owns the drawer-open state.
 */
export function ChatMenuButton({ onOpen, className }: ChatMenuButtonProps) {
  return (
    <button
      type="button"
      className={cx("btn", "btn-subtle", "btn-icon", "chat-menu-btn", className)}
      aria-label="Open navigation"
      onClick={onOpen}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 6h16M4 12h16M4 18h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
