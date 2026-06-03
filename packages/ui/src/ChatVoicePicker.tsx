import { avatarInitials, avatarTone } from "./ChatConversationList";
import { Chip } from "./Chip";
import { cx } from "./cx";

/** One selectable expert voice (M12.3.2), derived from the experts API (`ExpertVoice`). */
export interface ChatVoiceOption {
  /** Expert id — the {@link ChatVoicePickerProps.onSelect} target; "" is reserved for the neutral voice. */
  id: string;
  /** Display name → chip label + avatar initials/color. */
  name: string;
}

export interface ChatVoicePickerProps {
  /** Expert voices to offer as chips, in the order the caller wants them shown. */
  options: ChatVoiceOption[];
  /** Currently active expert id; "" (the default) selects the neutral, expert-less voice. */
  activeId?: string;
  /** Fired when a chip is chosen — the caller switches the active expert (""=neutral). */
  onSelect: (expertId: string) => void;
  /** Disables every chip (e.g. mid-stream) so the voice can't change during a turn. */
  disabled?: boolean;
}

/**
 * The conversation voice picker (M12.3.2) — a "VOICE" `.label` followed by `.chip` / `.chip.active`
 * pills, one per expert voice. Each chip carries a small expert-colored `.avatar` (initials) so the
 * active voice reads at a glance; the active chip gets the `.chip.active` (ink-900 fill) treatment.
 * Mounts into the `.chat-topbar-aside` slot of the {@link ChatTopbar}. Presentational only: the chat
 * page loads the experts API (M2.2), defaults to the primary expert, tracks the selected `expertId`,
 * and reuses it on the next turn so selecting a chip switches the conversation's expert. There is no
 * neutral / expert-less option — the product always answers in an expert's voice.
 */
export function ChatVoicePicker({
  options,
  activeId = "",
  onSelect,
  disabled = false,
}: ChatVoicePickerProps) {
  return (
    <div className="chat-voice-picker">
      <span className="label">Voice</span>
      {options.map((opt) => {
        const tone = avatarTone(opt.name);
        return (
          <Chip
            key={opt.id}
            active={opt.id === activeId}
            disabled={disabled}
            onClick={() => onSelect(opt.id)}
          >
            <span className={cx("avatar", "chat-voice-avatar", `tone-${tone}`)} aria-hidden="true">
              {avatarInitials(opt.name)}
            </span>
            {opt.name}
          </Chip>
        );
      })}
    </div>
  );
}
