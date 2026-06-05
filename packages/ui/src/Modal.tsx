import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

export interface ModalProps {
  /** Whether the modal is shown. When false the component renders nothing. */
  open: boolean;
  /** Dismiss handler — fired by the backdrop, the close (X) button, and Escape. */
  onClose: () => void;
  /** Heading shown in the header bar and used as the accessible dialog label. */
  title?: string;
  /** The modal body — scrolls within the panel when it overflows the viewport. */
  children?: ReactNode;
  /** Accessible label for the close (X) button (i18n M13). Defaults to English. */
  closeLabel?: string;
  className?: string;
}

/**
 * Centered modal dialog — a dimmed full-screen backdrop anchoring a centered `--surface` card with a
 * header (title + close X) over a scrollable body. The slide-over drawers ({@link SourcesDrawer},
 * {@link ChatSidebarDrawer}) anchor content to a screen edge; this one centers it, for self-contained
 * panels like the account view that don't belong to a particular edge of the chat workspace.
 *
 * Presentational and controlled — the host owns the open state. Dismissable by clicking the backdrop,
 * the close button, or pressing Escape while focus is inside the panel (no document-level listener, so
 * the component stays a pure function). Clicks inside the panel are stopped from reaching the
 * backdrop, so interacting with the body never dismisses it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  closeLabel = "Close",
  className,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={cx("modal", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Keep clicks inside the panel from bubbling to the backdrop (which dismisses).
        onClick={(e: MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="modal-head">
          {title ? <h2 className="h3 modal-title">{title}</h2> : <span />}
          <button
            type="button"
            className={cx("btn", "btn-subtle", "btn-icon")}
            onClick={onClose}
            aria-label={closeLabel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
