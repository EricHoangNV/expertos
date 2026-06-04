import { cx } from "./cx";
import {
  LAYOUT_DIRECTION_INFO,
  LAYOUT_DIRECTIONS,
  type LayoutDirection,
} from "./layout";

export interface TweaksLayoutControlProps {
  /** The active layout direction (the highlighted `.seg` option). */
  value: LayoutDirection;
  /** Fired when a direction is chosen — the caller switches + persists it (localStorage). */
  onChange: (direction: LayoutDirection) => void;
  /** Section header label (i18n M13). Defaults to English. */
  label?: string;
  /** Accessible label for the segmented control (i18n M13). Defaults to English. */
  ariaLabel?: string;
  /** Per-direction label + description copy (i18n M13). Defaults to {@link LAYOUT_DIRECTION_INFO}. */
  optionInfo?: Record<LayoutDirection, { label: string; description: string }>;
  className?: string;
}

/**
 * Chat-layout direction control (M12.7.2) — the "CHAT LAYOUT — 3 DIRECTIONS"
 * section of the Tweaks panel (PRD §"UI Reference Spec" #7). A `.label` header
 * over a full-width `.seg` segmented control (classic / studio / focus); the
 * active option gets the `.active` treatment, and the chosen direction's
 * one-line description renders below as `.muted` italic copy (each option also
 * carries its description as a `title` tooltip). Presentational only — the chat
 * page owns the {@link LayoutDirection} state, persists it to localStorage, and
 * passes it back as `value` (the {@link layoutPanes} mapping drives which panes
 * live in the persistent grid).
 */
export function TweaksLayoutControl({
  value,
  onChange,
  label = "Chat layout — 3 directions",
  ariaLabel = "Chat layout direction",
  optionInfo = LAYOUT_DIRECTION_INFO,
  className,
}: TweaksLayoutControlProps) {
  return (
    <div className={cx("tweaks-section", className)}>
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={ariaLabel}>
        {LAYOUT_DIRECTIONS.map((direction) => {
          const info = optionInfo[direction];
          const active = direction === value;
          return (
            <button
              key={direction}
              type="button"
              className={cx(active && "active")}
              aria-pressed={active}
              title={info.description}
              onClick={() => onChange(direction)}
            >
              {info.label}
            </button>
          );
        })}
      </div>
      <p className="muted tweaks-section-desc">{optionInfo[value].description}</p>
    </div>
  );
}
