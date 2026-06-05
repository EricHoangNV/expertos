import { cx } from "./cx";

export interface ChatTweaksToggleProps {
  /** Whether the Tweaks panel is currently open — drives the label and `aria-pressed`. */
  open: boolean;
  /** Toggle the panel open/closed. */
  onToggle: () => void;
  /** Caption when the panel is hidden (i18n M13). Defaults to English. */
  showLabel?: string;
  /** Caption when the panel is showing (i18n M13). Defaults to English. */
  hideLabel?: string;
  className?: string;
}

/**
 * Topbar "Hide tweaks" / "Show tweaks" toggle (M12.7.4) — the toolbar affordance that
 * mounts/unmounts the floating `TweaksPanel` (M12.7.1) from the conversation header
 * (PRD §"UI Reference Spec" #2, Toolbar row). An icon-only `.btn-subtle.btn-icon` control
 * that sits right-most in the header; its `aria-label`/`title` flip with `open` ("Hide
 * tweaks" when the panel is showing, "Show tweaks" when hidden) and it reports its state
 * via `aria-pressed`. Presentational only — the page owns the panel-open state and passes
 * `open`/`onToggle`.
 */
export function ChatTweaksToggle({
  open,
  onToggle,
  showLabel = "Show tweaks",
  hideLabel = "Hide tweaks",
  className,
}: ChatTweaksToggleProps) {
  const label = open ? hideLabel : showLabel;
  return (
    <button
      type="button"
      className={cx("btn", "btn-subtle", "btn-icon", "chat-tweaks-toggle", className)}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={label}
      title={label}
    >
      <svg
        className="chat-tweaks-toggle-icon"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h7M16 7h4M4 17h4M13 17h7" />
          <circle cx="13" cy="7" r="2.2" />
          <circle cx="10" cy="17" r="2.2" />
        </g>
      </svg>
    </button>
  );
}
