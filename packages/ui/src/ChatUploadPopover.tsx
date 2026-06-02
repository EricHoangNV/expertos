import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Accepted document formats shown as `.chip` pills in the popover header (M12.6.2).
 * Mirrors the M5 upload allowlist (the spec calls out the four document types; the
 * server is still the authority on what it accepts — see `UPLOAD_ACCEPT`).
 */
export const UPLOAD_FILE_TYPES = ["XLSX", "CSV", "PDF", "DOCX"] as const;

export interface ChatUploadPopoverProps {
  /** Dismiss the popover — fired by the close button. */
  onClose: () => void;
  /**
   * The retention-mode label shown as a `.badge-info` pill, e.g.
   * "Temporary · not indexed" / "Persistent · saved to knowledge". Reflects the
   * mode the user has selected so the indexing consequence is always visible.
   */
  modeLabel: string;
  /** Accepted file-type pills. Defaults to the M5 document allowlist. */
  fileTypes?: readonly string[];
  /** The upload controls (mode select, file input, uploaded-files list). */
  children?: ReactNode;
  className?: string;
}

/**
 * Upload-attachment popover (M12.6.2) — the dropdown that opens above the input bar
 * when the user clicks the attach button (M12.6.1). Presentational chrome only: a
 * header ("Attach document" + close X), a row of accepted file-type `.chip` pills
 * with a `.badge-info` mode label (so the "temporary → not indexed" consequence is
 * visible before upload), and a `children` slot for the actual upload controls
 * (the page mounts the stateful `UploadPanel` here). It renders inside the
 * `ChatInputBar` `children` slot so it stays anchored to the sticky composer.
 */
export function ChatUploadPopover({
  onClose,
  modeLabel,
  fileTypes = UPLOAD_FILE_TYPES,
  children,
  className,
}: ChatUploadPopoverProps) {
  return (
    <div
      className={cx("upload-popover", className)}
      role="dialog"
      aria-label="Attach document"
    >
      <div className="upload-popover-head">
        <span className="label">Attach document</span>
        <button
          type="button"
          className={cx("btn", "btn-subtle", "btn-icon")}
          onClick={onClose}
          aria-label="Close attachment panel"
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
      <div className="upload-popover-types">
        <span className="badge badge-info">{modeLabel}</span>
        {fileTypes.map((type) => (
          <span key={type} className="chip">
            {type}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}
