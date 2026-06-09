import type { ReactNode } from "react";
import { Button } from "./Button";

export interface ChatAnswerActionsProps {
  /**
   * Number of resolved sources behind the answer. When > 0 (and `onToggleSources` is given) the
   * "View sources (N)" toggle is rendered — render-after-resolve (M4.2), so it only appears once the
   * citations resolved to real chunks.
   */
  sourceCount?: number;
  /** Whether the sources drawer/rail is open — drives the toggle's pressed/expanded state. */
  sourcesOpen?: boolean;
  /** Toggle the sources drawer/rail; when omitted the View-sources control is not rendered. */
  onToggleSources?: () => void;
  /** True once the answer is bookmarked (M3.2) — the Save control becomes a static "Saved" state. */
  saved?: boolean;
  /** Disables the Save control while the save request is in flight. */
  saveBusy?: boolean;
  /** Bookmark the answer; when omitted the Save control is not rendered. */
  onSave?: () => void;
  /** Current feedback verdict (M3.4): true = helpful, false = not helpful, null/undefined = none yet. */
  verdict?: boolean | null;
  /** Disables the feedback buttons while a verdict is being saved. */
  feedbackBusy?: boolean;
  /** Record a 👍/👎 verdict; when omitted the feedback buttons are not rendered. */
  onFeedback?: (helpful: boolean) => void;
  /** Copy the answer text to the clipboard; when omitted the Copy control is not rendered. */
  onCopy?: () => void;
  /** True just after a successful copy — the Copy control reads "Copied" until the host clears it. */
  copied?: boolean;
  /** Extra content rendered under the bar (e.g. the feedback reason field, a save/feedback error). */
  children?: ReactNode;
}

/**
 * The action bar under a completed answer (M12.4.4): a single horizontal `.msg-actions-bar` row
 * laying out the "View sources (N)" toggle (`.btn-ghost`), the Save control (`.btn-ghost`, swapping
 * to a static "Saved" badge once bookmarked), and the 👍/👎 feedback buttons (`.btn-subtle`, the
 * active verdict promoted to primary/dark — text "Yes"/"No" per the anti-emoji rule, with the
 * helpful/not-helpful intent on the `aria-label`), and a trailing "Copy" control that copies the
 * answer to the clipboard (reading "Copied" while the host holds `copied`). Presentational only: the
 * page owns the auth + network + clipboard state and threads it in; follow-up content (the feedback
 * reason field, errors) renders as `children` on a row below. Each control is omitted when its
 * callback is not supplied.
 */
export function ChatAnswerActions({
  sourceCount = 0,
  sourcesOpen = false,
  onToggleSources,
  saved = false,
  saveBusy = false,
  onSave,
  verdict = null,
  feedbackBusy = false,
  onFeedback,
  onCopy,
  copied = false,
  children,
}: ChatAnswerActionsProps) {
  return (
    <div className="msg-actions">
      <div className="msg-actions-bar">
        {onToggleSources && sourceCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSources}
            aria-expanded={sourcesOpen}
            aria-pressed={sourcesOpen}
          >
            View sources ({sourceCount})
          </Button>
        )}
        {onSave &&
          (saved ? (
            <span className="badge badge-green">Saved</span>
          ) : (
            <Button variant="ghost" size="sm" onClick={onSave} disabled={saveBusy}>
              Save
            </Button>
          ))}
        {onFeedback && (
          <>
            <Button
              variant={verdict === true ? "primary" : "subtle"}
              size="sm"
              onClick={() => onFeedback(true)}
              disabled={feedbackBusy}
              aria-pressed={verdict === true}
              aria-label="Helpful"
            >
              Yes
            </Button>
            <Button
              variant={verdict === false ? "dark" : "subtle"}
              size="sm"
              onClick={() => onFeedback(false)}
              disabled={feedbackBusy}
              aria-pressed={verdict === false}
              aria-label="Not helpful"
            >
              No
            </Button>
          </>
        )}
        {onCopy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopy}
            aria-label={copied ? "Answer copied" : "Copy answer"}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
