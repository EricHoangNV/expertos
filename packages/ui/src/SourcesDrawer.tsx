import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";
import { SourcesRail } from "./SourcesRail";

export interface SourcesDrawerProps {
  /** Whether the drawer is shown. When false the component renders nothing. */
  open: boolean;
  /** Dismiss handler — fired by the backdrop, the close button, and Escape. */
  onClose: () => void;
  /**
   * Header region (M12.5.2) — the `SourcesRailHeader` ("SOURCES" label + passage
   * count + trust badge) mounts here, identical to the persistent rail.
   */
  header?: ReactNode;
  /** Source cards (M12.5.3) — the same numbered cards the rail shows. */
  children?: ReactNode;
  /** Empty-state copy when the selected answer has no resolved sources. */
  emptyLabel?: string;
  /** Accessible dialog label (the slide-over has no visible title of its own). */
  title?: string;
  className?: string;
}

/**
 * Sources drawer fallback (M12.5.4) — the slide-over presentation of the sources
 * rail for when the persistent `.sources-rail` is not in the grid: the `classic` /
 * `focus` layout directions (M12.1.3) or any viewport narrow enough to collapse the
 * rail (< 1280px, M12.1.1). It reuses {@link SourcesRail} for the body so the header,
 * source cards, and empty state never drift from the persistent panel — only the
 * chrome differs: a dimmed backdrop, a right-anchored slide-in panel, and a close
 * affordance.
 *
 * Presentational and controlled: the chat page owns the open state and decides when
 * to route "View sources" to the drawer vs. the rail. Dismissable by clicking the
 * backdrop, the close button, or pressing Escape while focus is inside the panel
 * (no document-level listener, so the component stays a pure function).
 */
export function SourcesDrawer({
  open,
  onClose,
  header,
  children,
  emptyLabel,
  title = "Sources",
  className,
}: SourcesDrawerProps) {
  if (!open) return null;
  return (
    <div className="sources-drawer-backdrop" onClick={onClose}>
      <aside
        className={cx("sources-drawer", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Keep clicks inside the panel from bubbling to the backdrop (which dismisses).
        onClick={(e: MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <button
          type="button"
          className="sources-drawer-close"
          aria-label="Close sources"
          onClick={onClose}
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
        <SourcesRail header={header} emptyLabel={emptyLabel}>
          {children}
        </SourcesRail>
      </aside>
    </div>
  );
}
