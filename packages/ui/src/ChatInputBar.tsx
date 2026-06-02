import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import { Textarea } from "./Field";

/**
 * Grow/shrink the textarea to fit its content (M12.6.4). Used as an inline ref
 * callback so it re-runs on every render — covering keystrokes, deletions, and
 * the parent clearing the draft after a send. `min/max-height` in ds.css clamp
 * the rendered height (overflow scrolls past the cap), so this only needs to
 * track `scrollHeight`.
 */
function autoResize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export interface ChatInputBarProps {
  /** Controlled draft value. */
  value: string;
  /** Fired on each keystroke — the page owns the draft state. */
  onChange: (value: string) => void;
  /** Send the current draft. Wired to the crimson send button (and Enter in M12.6.4). */
  onSend: () => void;
  /**
   * Input placeholder. Defaults to the spec's generic prompt; the page passes
   * "Ask [Expert] anything about your business…" once a voice is selected.
   */
  placeholder?: string;
  /**
   * True while a turn is streaming — disables the input and the send button so a
   * second turn can't be started mid-answer.
   */
  busy?: boolean;
  /**
   * Attach-document handler. When supplied, a left-aligned `.btn-subtle` paperclip
   * button renders; M12.6.2 wires it to open the upload popover. Omitted = no button.
   */
  onAttach?: () => void;
  /** True when the attach popover is open (M12.6.2) — reflected as `aria-expanded`/pressed. */
  attachActive?: boolean;
  /**
   * Slot above the input row — the upload popover (M12.6.2) and/or the helper text
   * row (M12.6.3) mount here so they stay inside the sticky bar.
   */
  children?: ReactNode;
}

/**
 * The sticky bottom input bar (M12.6.1) — a `.input-bar` container holding the
 * attach-document button (left, `.btn-subtle` icon), the question text input, and
 * the crimson circular send button (right). Presentational only: the page owns the
 * draft value, the send action, and the busy/streaming state. The attach button is
 * rendered only when `onAttach` is supplied (M12.6.2 wires the upload popover); the
 * `children` slot hosts the popover + helper text (M12.6.2 / M12.6.3). Enter
 * sends (Shift+Enter inserts a newline) and the textarea auto-resizes to its
 * content (M12.6.4).
 */
export function ChatInputBar({
  value,
  onChange,
  onSend,
  placeholder = "Ask anything about your business…",
  busy = false,
  onAttach,
  attachActive = false,
  children,
}: ChatInputBarProps) {
  const canSend = !busy && value.trim().length > 0;
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter (and IME composition) fall through to a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };
  return (
    <div className="input-bar">
      {children}
      <div className="input-bar-row">
        {onAttach && (
          <button
            type="button"
            className={cx("btn", "btn-subtle", "btn-icon", "input-bar-attach")}
            onClick={onAttach}
            disabled={busy}
            aria-label="Attach document"
            aria-expanded={attachActive}
            aria-pressed={attachActive}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M21 11.5l-8.5 8.5a5 5 0 01-7-7l8.5-8.5a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3l8-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <Textarea
          className="input-bar-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          inputRef={autoResize}
          disabled={busy}
          rows={1}
          placeholder={placeholder}
          aria-label="Your question"
        />
        <button
          type="button"
          className={cx("btn", "btn-primary", "input-bar-send")}
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 19V5M12 5l-7 7M12 5l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
