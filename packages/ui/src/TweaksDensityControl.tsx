import { cx } from "./cx";
import { DENSITIES, DENSITY_INFO, type Density } from "./prefs";

export interface TweaksDensityControlProps {
  /** The active display density (the highlighted `.seg` option). */
  density: Density;
  /** Fired when a density is chosen — the caller switches + persists it (localStorage). */
  onDensityChange: (density: Density) => void;
  /** Whether the assistant "Verified" `.badge-green` trust badge is shown (M12.4.2). */
  verifiedBadge: boolean;
  /** Toggle the "Verified trust badge" option. */
  onVerifiedBadgeChange: (on: boolean) => void;
  /** Whether the concierge human-review offer is surfaced (forward-looking preference). */
  conciergeOffer: boolean;
  /** Toggle the "Concierge review offer" option. */
  onConciergeOfferChange: (on: boolean) => void;
  /** Section header label (i18n M13). Defaults to English. */
  label?: string;
  /** Accessible label for the segmented control (i18n M13). Defaults to English. */
  ariaLabel?: string;
  /** Per-density label + description copy (i18n M13). Defaults to {@link DENSITY_INFO}. */
  densityInfo?: Record<Density, { label: string; description: string }>;
  /** Label for the citations-resolved-badge toggle (i18n M13). Defaults to English. */
  verifiedBadgeLabel?: string;
  /** Label for the concierge-review-offer toggle (i18n M13). Defaults to English. */
  conciergeOfferLabel?: string;
  className?: string;
}

/** The two `.switch` options rendered below the density segmented control. */
interface ToggleOption {
  key: string;
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
}

/**
 * Density & options control (M12.7.3) — the "DENSITY & OPTIONS" section of the
 * Tweaks panel (PRD §"UI Reference Spec" #7). A `.label` header over a full-width
 * `.seg` segmented control (compact / regular / comfy, the active option getting
 * the `.active` treatment), then two `.switch` toggle rows ("Verified trust badge",
 * "Concierge review offer"). Presentational only — the chat page owns the
 * {@link Density} + toggle state, persists each to localStorage, and passes them
 * back as props (density drives the `chat-density-*` modifier; the verified toggle
 * gates the M12.4.2 "Verified" badge).
 */
export function TweaksDensityControl({
  density,
  onDensityChange,
  verifiedBadge,
  onVerifiedBadgeChange,
  conciergeOffer,
  onConciergeOfferChange,
  label = "Density & options",
  ariaLabel = "Display density",
  densityInfo = DENSITY_INFO,
  verifiedBadgeLabel = "Citations-resolved badge",
  conciergeOfferLabel = "Concierge review offer",
  className,
}: TweaksDensityControlProps) {
  const toggles: ToggleOption[] = [
    {
      key: "verified-badge",
      label: verifiedBadgeLabel,
      value: verifiedBadge,
      onChange: onVerifiedBadgeChange,
    },
    {
      key: "concierge-offer",
      label: conciergeOfferLabel,
      value: conciergeOffer,
      onChange: onConciergeOfferChange,
    },
  ];

  return (
    <div className={cx("tweaks-section", className)}>
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={ariaLabel}>
        {DENSITIES.map((option) => {
          const info = densityInfo[option];
          const active = option === density;
          return (
            <button
              key={option}
              type="button"
              className={cx(active && "active")}
              aria-pressed={active}
              title={info.description}
              onClick={() => onDensityChange(option)}
            >
              {info.label}
            </button>
          );
        })}
      </div>
      <div className="tweaks-toggles">
        {toggles.map((toggle) => (
          <label key={toggle.key} className="tweaks-toggle">
            <span>{toggle.label}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={toggle.value}
                onChange={(e) => toggle.onChange(e.target.checked)}
              />
              <span className="track" />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
