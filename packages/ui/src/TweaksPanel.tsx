import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TweaksPanelProps {
  /** Dismiss the panel — fired by the close (X) button. */
  onClose: () => void;
  /**
   * The panel sections (layout-direction control M12.7.2, density/options
   * M12.7.3). Rendered below the header in a vertical stack.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * Tweaks floating panel (M12.7.1) — the layout-preferences overlay anchored to
 * the bottom-right of the chat view (PRD §"UI Reference Spec" #7). Presentational
 * chrome only: a `--font-display` "Tweaks" heading with a close (X) button over a
 * shadowed `--surface` card, plus a `children` slot for the preference sections
 * the later tasks fill in (the `.seg` direction switcher M12.7.2, the density
 * `.seg` + `.switch` toggles M12.7.3). The "Hide tweaks"/"Show tweaks" topbar
 * affordance that mounts/unmounts this panel is M12.7.4.
 */
export function TweaksPanel({ onClose, children, className }: TweaksPanelProps) {
  return (
    <div
      className={cx("tweaks-panel", className)}
      role="dialog"
      aria-label="Tweaks"
    >
      <div className="tweaks-panel-head">
        <h3 className="h3">Tweaks</h3>
        <button
          type="button"
          className={cx("btn", "btn-subtle", "btn-icon")}
          onClick={onClose}
          aria-label="Close tweaks panel"
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
      {children}
    </div>
  );
}
