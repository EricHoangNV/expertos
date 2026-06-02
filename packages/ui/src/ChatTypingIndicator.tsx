import { cx } from "./cx";

export interface ChatTypingIndicatorProps {
  className?: string;
  /** Accessible label announced while the answer streams (default "Generating answer"). */
  label?: string;
}

/**
 * Streaming "typing" indicator (M12.9.4, PRD §"State Mapping": "Ellipsis or typing
 * indicator under expert avatar") — three pulsing dots shown inside the assistant
 * message (so they read as under the expert avatar/header) while a turn is still
 * streaming and no prose has arrived yet. The dots are decorative (`aria-hidden`); the
 * wrapper is a polite live `role="status"` with an accessible label so assistive tech
 * hears the state instead of the bare dots.
 */
export function ChatTypingIndicator({
  className,
  label = "Generating answer",
}: ChatTypingIndicatorProps) {
  return (
    <span className={cx("typing", className)} role="status" aria-label={label}>
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
      <span className="typing-dot" aria-hidden="true" />
    </span>
  );
}
