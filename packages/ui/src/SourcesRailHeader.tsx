import { cx } from "./cx";

export interface SourcesRailHeaderProps {
  /**
   * Number of resolved source passages backing the currently selected / latest answer.
   * Drives the passage count and the render-after-resolve trust badge: both appear only
   * once at least one citation has resolved to a real chunk (never flashed mid-stream).
   */
  count: number;
  /**
   * Trust-badge copy — the "all citations resolved" guarantee. The badge is shown only when
   * `count > 0`, so the claim is never made before the sources actually resolve.
   */
  trustLabel?: string;
  className?: string;
}

/** "N passages" / "1 passage" — the resolved-passage count label. */
function passageCountLabel(count: number): string {
  return count === 1 ? "1 passage" : `${count} passages`;
}

/**
 * Sources-rail header (M12.5.2) — the "SOURCES" `.label` + resolved-passage count over an
 * outlined-crimson `.trust-badge` ("all citations resolved to a real chunk", with a checkmark).
 *
 * Mounts in `SourcesRail`'s `header` slot (M12.5.1). Presentational: the chat page passes the
 * count of resolved citations for the current answer. Render-after-resolve (PRD §"Design System",
 * OD#7) is enforced here too — the passage count and the trust guarantee surface only once
 * `count > 0`, so the panel never claims resolution before a single citation has resolved.
 */
export function SourcesRailHeader({
  count,
  trustLabel = "All citations resolved to a real chunk",
  className,
}: SourcesRailHeaderProps) {
  const resolved = count > 0;
  return (
    <div className={cx("sources-rail-title", className)}>
      <div className="sources-rail-title-row">
        <span className="label">Sources</span>
        {resolved && <span className="sources-rail-count mono muted">{passageCountLabel(count)}</span>}
      </div>
      {resolved && (
        <span className="trust-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {trustLabel}
        </span>
      )}
    </div>
  );
}
