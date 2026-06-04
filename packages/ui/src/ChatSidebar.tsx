import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Button } from "./Button";

export interface ChatSidebarProps extends HTMLAttributes<HTMLDivElement> {
  /** Fired when "+ New conversation" is clicked — the chat page clears the active chat. */
  onNewConversation: () => void;
  /**
   * Optional collapse control (M12.2.1). When supplied, a close button renders in
   * the brand row. The responsive overlay (M12.9.1) and Tweaks direction switcher
   * (M12.7) are what actually call it, so callers opt in only once a re-open
   * affordance exists — keeping the control from becoming a dead end.
   */
  onClose?: () => void;
  /** Body region — conversation search (M12.2.2) + list (M12.2.3) mount here. */
  children?: ReactNode;
  /** Pinned footer region — usage + plan meter (M12.2.4) mounts here. */
  footer?: ReactNode;
  /** Label for the "+ New conversation" action (i18n M13). Defaults to English. */
  newConversationLabel?: string;
  /** Accessible label for the collapse (X) button (i18n M13). Defaults to English. */
  collapseLabel?: string;
}

/**
 * Consumer chat sidebar shell (M12.2.1) — the dark ds.css `.side` rail that fills
 * the `.chat-layout` sidebar pane: the ExpertOS wordmark (white `.expert` + crimson
 * `.os`), an optional collapse button, and a full-width crimson "+ New conversation"
 * action. The conversation search/list (M12.2.2–3) mount as `children`; the usage
 * meter (M12.2.4) mounts as `footer`. Presentational only — all data wiring lives in
 * the chat page.
 */
export function ChatSidebar({
  onNewConversation,
  onClose,
  children,
  footer,
  newConversationLabel = "+ New conversation",
  collapseLabel = "Collapse sidebar",
  className,
  ...rest
}: ChatSidebarProps) {
  return (
    <div className={cx("side", "chat-side", className)} {...rest}>
      <div className="brand">
        <span className="logo">
          <span className="expert">Expert</span>
          <span className="os">OS</span>
        </span>
        {onClose && (
          <button
            type="button"
            className="chat-side-collapse"
            aria-label={collapseLabel}
            onClick={onClose}
          >
            <svg
              className="ic"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <Button variant="primary" className="chat-side-new" onClick={onNewConversation}>
        {newConversationLabel}
      </Button>
      {children != null && <div className="chat-side-body">{children}</div>}
      {footer != null && <div className="chat-side-foot">{footer}</div>}
    </div>
  );
}
