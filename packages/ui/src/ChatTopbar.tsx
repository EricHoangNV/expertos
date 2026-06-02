import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

export interface ChatTopbarProps {
  /** Conversation title — the page supplies a fallback ("New conversation") for an unsaved chat. */
  title: string;
  /**
   * Whether the title can be renamed. False for a brand-new, unsaved chat that has no conversation
   * id yet (M3.2 auto-titles on the first turn); the title then renders as static, non-clickable text.
   */
  titleEditable?: boolean;
  /** True while the title is being edited — renders a controlled `.input` in place of the heading. */
  editing?: boolean;
  /** The in-progress edited title (controlled by the page). */
  draft?: string;
  /** Fired as the edited title changes. */
  onDraftChange?: (value: string) => void;
  /** Fired when the editable heading is clicked — the page flips into edit mode. */
  onEditStart?: () => void;
  /** Commit the edited title (Enter or blur). */
  onCommit?: () => void;
  /** Abandon the edit (Escape). */
  onCancel?: () => void;
  /**
   * Optional leading region before the title — the sidebar menu button (M12.9.1) mounts here when the
   * sidebar is an overlay rather than in the grid, so the hamburger sits at the left of the header.
   */
  leading?: ReactNode;
  /**
   * Optional right-aligned region — the voice picker (M12.3.2) + user identity (M12.3.3) mount here.
   * Kept as a slot so this task ships the title bar without those pieces existing yet.
   */
  children?: ReactNode;
}

/**
 * The conversation header (M12.3.1) — the `.topbar` strip at the top of the chat column showing the
 * conversation title (auto-titled by M3.2) and, when supplied, a right-aligned region for the voice
 * picker (M12.3.2) and user identity (M12.3.3). The title is editable on click: clicking the heading
 * flips the page into edit mode (`onEditStart`), which swaps in a controlled `.input` committed on
 * Enter/blur and abandoned on Escape. A chat with no conversation id yet (`titleEditable={false}`)
 * shows the title as static text since there is nothing to rename until the first turn is saved.
 * Presentational only — the page owns the editing state and calls `renameConversation` (M3.2).
 */
export function ChatTopbar({
  title,
  titleEditable = true,
  editing = false,
  draft = "",
  onDraftChange,
  onEditStart,
  onCommit,
  onCancel,
  leading,
  children,
}: ChatTopbarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  };

  return (
    <header className="topbar chat-topbar">
      {leading != null && <div className="chat-topbar-leading">{leading}</div>}
      {editing && titleEditable ? (
        <input
          className="input chat-topbar-title-input"
          value={draft}
          onChange={(event) => onDraftChange?.(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => onCommit?.()}
          aria-label="Conversation title"
          maxLength={100}
          autoFocus
        />
      ) : titleEditable ? (
        <button
          type="button"
          className="chat-topbar-title"
          onClick={onEditStart}
          title="Rename conversation"
        >
          {title}
        </button>
      ) : (
        <span className={cx("chat-topbar-title", "chat-topbar-title-static")}>{title}</span>
      )}
      {children != null && <div className="chat-topbar-aside">{children}</div>}
    </header>
  );
}
