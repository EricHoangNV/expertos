import { cx } from "./cx";

/** Which side the user bubble hugs — right-aligned by default; focus mode can left-align it (M12.4.1). */
export type ChatUserMessageAlign = "start" | "end";

export interface ChatUserMessageProps {
  /** The user's message text (preserves newlines from Shift+Enter — directive §1 length is enforced upstream). */
  content: string;
  /** Bubble alignment within the chat column; defaults to "end" (right-aligned). */
  align?: ChatUserMessageAlign;
}

/**
 * A user message bubble in the chat transcript (M12.4.1) — a dark (`--ink-900`), white-text,
 * `--r-lg`-rounded bubble capped at ~70% of the chat column width. Right-aligned by default
 * ("end"); the page can pass `align="start"` to left-align it (e.g. focus direction). The text
 * preserves the user's own line breaks (`white-space: pre-wrap`). Presentational only.
 */
export function ChatUserMessage({ content, align = "end" }: ChatUserMessageProps) {
  return (
    <div className={cx("msg-user", align === "start" && "msg-user-start")}>
      <p className="msg-user-bubble">{content}</p>
    </div>
  );
}
