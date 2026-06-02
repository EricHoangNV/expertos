import type { ReactNode } from "react";
import { Button } from "./Button";

export interface ChatConsultationCardProps {
  /**
   * Heading copy. Defaults to the spec's "This looks worth a working session" — the warm nudge that
   * a recommendation rule (M7.1) fired under the answer.
   */
  heading?: string;
  /** Description / reason text (the funnel rule's `reason`, M7.2). */
  description?: ReactNode;
  /**
   * Label for the primary Book action. Defaults to "Book a consultation"; the page passes
   * "Book with [Expert]" / "Book [Consultation type]" per the matched recommendation (M7.2).
   */
  bookLabel?: string;
  /** Record the "book" choice (opens the TidyCal link). Required for the primary button to render. */
  onBook?: () => void;
  /** Record the "maybe later" dismissal. */
  onMaybeLater?: () => void;
  /** Record the "ask another question" dismissal. */
  onAskAnother?: () => void;
  /** Disables all three actions while a choice is being recorded. */
  busy?: boolean;
  /** Follow-up content under the actions (e.g. an error note). */
  children?: ReactNode;
}

/**
 * The in-chat consultation recommendation card (M12.4.5) — a warm `.consult-card` shown under an
 * answer when a funnel rule fired (M7.1): a calendar icon + heading, the rule's reason, and the
 * three M7.2 actions ("Book with [Expert]" primary, "Maybe later" + "Ask another question" ghost).
 * Presentational only — the page owns the auth + network state (records each choice against the
 * recommendation id for funnel attribution, M10.2) and threads in the labels, busy flag, and any
 * error as `children`. Each action is omitted when its callback is not supplied.
 */
export function ChatConsultationCard({
  heading = "This looks worth a working session",
  description,
  bookLabel = "Book a consultation",
  onBook,
  onMaybeLater,
  onAskAnother,
  busy = false,
  children,
}: ChatConsultationCardProps) {
  return (
    <div className="consult-card">
      <div className="consult-card-head">
        <span className="consult-card-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" focusable="false">
            <rect
              x="3"
              y="5"
              width="18"
              height="16"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M3 9h18M8 3v4M16 3v4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <p className="consult-card-title">{heading}</p>
      </div>
      {description != null && <p className="consult-card-desc">{description}</p>}
      <div className="consult-card-actions">
        {onBook && (
          <Button variant="primary" onClick={onBook} disabled={busy}>
            {bookLabel}
          </Button>
        )}
        {onMaybeLater && (
          <Button variant="ghost" onClick={onMaybeLater} disabled={busy}>
            Maybe later
          </Button>
        )}
        {onAskAnother && (
          <Button variant="ghost" onClick={onAskAnother} disabled={busy}>
            Ask another question
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
