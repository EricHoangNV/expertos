import type { ChatLanguage } from "./ChatUserIdentity";
import { cx } from "./cx";

/** The two answer languages M1 supports, in display order. */
const LANGUAGES: readonly ChatLanguage[] = ["en", "vi"];

/** Default short labels for the EN/VI segmented options (i18n via {@link TweaksLanguageControlProps.optionLabels}). */
const LANGUAGE_LABEL: Record<ChatLanguage, string> = { en: "EN", vi: "VI" };

export interface TweaksLanguageControlProps {
  /** The active answer language (the highlighted `.seg` option). */
  value: ChatLanguage;
  /** Fired when a language is chosen — the caller switches + persists it (localStorage + profile). */
  onChange: (language: ChatLanguage) => void;
  /** Section header label (i18n M13). Defaults to English. */
  label?: string;
  /** Accessible label for the segmented control (i18n M13). Defaults to English. */
  ariaLabel?: string;
  /** Per-language option labels (i18n M13). Defaults to {@link LANGUAGE_LABEL}. */
  optionLabels?: Record<ChatLanguage, string>;
  className?: string;
}

/**
 * Answer-language control — the "ANSWER LANGUAGE" section of the Tweaks panel.
 * A `.label` header over a full-width `.seg` segmented control (EN / VI); the
 * active option gets the `.active` treatment. Replaces the EN/VI badge that used
 * to sit in the {@link ChatUserIdentity} header strip (M12.3.3); the chat page now
 * mounts this inside the {@link TweaksPanel}. Presentational only — the chat page
 * owns the {@link ChatLanguage} state, persists it (localStorage + profile), and
 * reuses the choice on the next turn (M1 EN+VI retrieval).
 */
export function TweaksLanguageControl({
  value,
  onChange,
  label = "Answer language",
  ariaLabel = "Answer language",
  optionLabels = LANGUAGE_LABEL,
  className,
}: TweaksLanguageControlProps) {
  return (
    <div className={cx("tweaks-section", className)}>
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={ariaLabel}>
        {LANGUAGES.map((lang) => {
          const active = lang === value;
          return (
            <button
              key={lang}
              type="button"
              className={cx(active && "active")}
              aria-pressed={active}
              onClick={() => onChange(lang)}
            >
              {optionLabels[lang]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
