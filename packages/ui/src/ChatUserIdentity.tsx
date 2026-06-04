import { avatarInitials, avatarTone } from "./ChatConversationList";
import { cx } from "./cx";

/** The answer language the user is asking in (M1 supports EN + VI). */
export type ChatLanguage = "en" | "vi";

const LANGUAGE_LABEL: Record<ChatLanguage, string> = { en: "EN", vi: "VI" };

export interface ChatUserIdentityProps {
  /** The signed-in user's display name → name text + avatar initials/color. */
  name?: string | null;
  /** Email fallback when there is no display name (initials + label derive from the local part). */
  email?: string | null;
  /** The current answer language, shown as an EN/VI badge. */
  language: ChatLanguage;
  /**
   * Fired when the language badge is clicked — the page cycles EN ↔ VI and reuses the choice on the
   * next turn. Omit to render the badge as a static, non-interactive label.
   */
  onLanguageToggle?: () => void;
  /**
   * Accessible-label template for the language toggle with a `{lang}` token (i18n M13).
   * Defaults to English. e.g. "Answer language {lang} — switch language".
   */
  switchLanguageAriaLabel?: string;
  /** Tooltip/title for the language toggle (i18n M13). Defaults to English. */
  switchLanguageLabel?: string;
}

/**
 * The right-aligned user identity strip in the conversation header (M12.3.3) — an avatar (initials on
 * an expert-style colored circle), the user's name, and an EN/VI language badge. Mounts into the
 * `.chat-topbar-aside` slot of the {@link ChatTopbar}, alongside the voice picker (M12.3.2). The
 * language badge is interactive when {@link ChatUserIdentityProps.onLanguageToggle} is supplied:
 * clicking it cycles the answer language (EN ↔ VI), which the page reuses on the next turn (M1 EN+VI
 * retrieval). Presentational only — the page owns the name (from Firebase auth) and the language state.
 */
export function ChatUserIdentity({
  name,
  email,
  language,
  onLanguageToggle,
  switchLanguageAriaLabel = "Answer language {lang} — switch language",
  switchLanguageLabel = "Switch answer language",
}: ChatUserIdentityProps) {
  const local = email?.split("@")[0] ?? null;
  const seed = name?.trim() || local?.trim() || "You";
  const displayName = name?.trim() || local?.trim() || "You";
  const tone = avatarTone(seed);
  const langLabel = LANGUAGE_LABEL[language];

  return (
    <div className="chat-user-identity">
      <span className={cx("avatar", "chat-user-avatar", `tone-${tone}`)} aria-hidden="true">
        {avatarInitials(seed)}
      </span>
      <span className="chat-user-name">{displayName}</span>
      {onLanguageToggle ? (
        <button
          type="button"
          className="badge badge-ink chat-user-lang"
          onClick={onLanguageToggle}
          aria-label={switchLanguageAriaLabel.replace("{lang}", langLabel)}
          title={switchLanguageLabel}
        >
          {langLabel}
        </button>
      ) : (
        <span className="badge badge-ink chat-user-lang">{langLabel}</span>
      )}
    </div>
  );
}
