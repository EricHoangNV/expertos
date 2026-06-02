import { cx } from "./cx";

/** The fixed avatar-color palette (ds.css `.avatar.tone-*`); one is picked deterministically per expert. */
export const AVATAR_TONES = ["crimson", "green", "info", "amber", "ink"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/**
 * Up to two uppercase initials for an avatar, split on whitespace/hyphens
 * (e.g. "James Pierce" → "JP", "John-Ngo" → "JN"). Falls back to "?" for an
 * empty/blank name (neutral, expert-less conversations).
 */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/[\s-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]);
  return letters.join("").toUpperCase() || "?";
}

/**
 * Deterministic avatar tone for an expert — a stable hash over the seed so the
 * same expert always gets the same color circle across the sidebar, header, and
 * messages. Pure, so the color never flickers between renders.
 */
export function avatarTone(seed: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

/**
 * Compact relative time for a conversation's last activity: "Now", "5m ago",
 * "3h ago", "Yesterday", a weekday ("Mon"), "Last week", or a short date for
 * anything older. `now` is injectable so the formatting is deterministic in
 * tests; bad/missing input yields an empty string (guarded — directive §3.5).
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const diff = now - then;
  if (diff < min) return "Now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  const days = Math.floor(diff / day);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(then).toLocaleDateString(undefined, { weekday: "short" });
  if (days < 14) return "Last week";
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One row in the sidebar conversation list (M12.2.3), derived from `ConversationSummaryDto` (M3.2). */
export interface ChatConversationItem {
  /** Conversation id — the {@link ChatConversationListProps.onSelect} target. */
  id: string;
  /** Display title (the caller supplies a fallback for null/untitled conversations). */
  title: string;
  /** Expert display name → avatar initials + color; null for neutral (expert-less) conversations. */
  expertName: string | null;
  /** ISO-8601 timestamp of the last turn — drives the relative time and the most-recent-first sort. */
  updatedAt: string;
  /** Optional unread indicator (a red dot); the consumer web has no unread signal yet, so it's opt-in. */
  unread?: boolean;
}

export interface ChatConversationListProps {
  /** Conversations to list — the caller pre-sorts most-recent-first (the API already does). */
  items: ChatConversationItem[];
  /** Id of the currently open conversation, highlighted with `.navitem.active`. */
  activeId?: string;
  /** Fired when a row is chosen — the caller opens that conversation. */
  onSelect: (id: string) => void;
  /** True while the first page is loading — softens the empty note to "Loading…". */
  loading?: boolean;
}

/**
 * The dark-rail conversation history list (M12.2.3) — a "RECENT" `.navgroup` label over
 * `.navitem` rows, each with an expert-colored `.avatar` (initials), a truncated title, a
 * relative timestamp, and an optional unread dot. The active conversation gets `.navitem.active`.
 * Presentational only: the chat page loads the history API (M3.2), resolves expert names, sorts
 * most-recent-first, and passes the rows in; choosing one fires `onSelect` so the page opens it.
 */
export function ChatConversationList({
  items,
  activeId,
  onSelect,
  loading = false,
}: ChatConversationListProps) {
  return (
    <nav className="chat-convos" aria-label="Recent conversations">
      <div className="navgroup">Recent</div>
      {items.length === 0 ? (
        <p className="chat-convos-empty muted">{loading ? "Loading…" : "No conversations yet."}</p>
      ) : (
        items.map((item) => {
          const expert = item.expertName?.trim();
          return (
            <button
              key={item.id}
              type="button"
              className={cx("navitem", "chat-convo", item.id === activeId && "active")}
              onClick={() => onSelect(item.id)}
            >
              <span
                className={cx("avatar", "chat-convo-avatar", expert && `tone-${avatarTone(expert)}`)}
                aria-hidden="true"
              >
                {avatarInitials(item.expertName)}
              </span>
              <span className="chat-convo-main">
                <span className="chat-convo-title">{item.title}</span>
                <span className="chat-convo-time">{relativeTime(item.updatedAt)}</span>
              </span>
              {item.unread && <span className="chat-convo-dot" aria-label="Unread" />}
            </button>
          );
        })
      )}
    </nav>
  );
}
