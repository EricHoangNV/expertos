import type { ReactNode } from "react";
import { cx } from "./cx";

export interface ChatEmptyStateProps {
  /** Heading for the empty thread (e.g. "Start a new conversation"). */
  title: string;
  /** Supporting line under the heading. */
  description?: ReactNode;
  /** Optional extra content below the copy (e.g. example prompts). */
  children?: ReactNode;
  className?: string;
}

/**
 * Empty-thread state (M12.9.4) — the centered "start a new conversation" prompt shown in
 * the chat scroll region before the first message is sent. A speech-bubble glyph over a
 * display heading + muted supporting copy, with an optional `children` slot. Presentational
 * only; the chat page swaps this in for the message thread while `messages` is empty.
 */
export function ChatEmptyState({ title, description, children, className }: ChatEmptyStateProps) {
  return (
    <div className={cx("chat-empty", className)}>
      <span className="chat-empty-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" focusable="false">
          <path
            d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h2 className="chat-empty-title h2">{title}</h2>
      {description && <p className="chat-empty-desc muted">{description}</p>}
      {children}
    </div>
  );
}
