import { cx } from "./cx";
import { Skeleton } from "./Skeleton";

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
 * Locale-overridable copy for {@link relativeTime} (i18n M13). The `minutesAgo`/`hoursAgo`
 * templates carry a `{count}` token the function substitutes; `locale` is the BCP-47 tag used
 * for the weekday and short-date branches (e.g. "vi-VN"). Omit any field to keep the English
 * default — admin and tests call `relativeTime` with no labels and stay on English.
 */
export interface RelativeTimeLabels {
  now: string;
  minutesAgo: string;
  hoursAgo: string;
  yesterday: string;
  lastWeek: string;
  locale?: string;
}

const DEFAULT_TIME_LABELS: RelativeTimeLabels = {
  now: "Now",
  minutesAgo: "{count}m ago",
  hoursAgo: "{count}h ago",
  yesterday: "Yesterday",
  lastWeek: "Last week",
};

/**
 * Compact relative time for a conversation's last activity: "Now", "5m ago",
 * "3h ago", "Yesterday", a weekday ("Mon"), "Last week", or a short date for
 * anything older. `now` is injectable so the formatting is deterministic in
 * tests; bad/missing input yields an empty string (guarded — directive §3.5).
 * `labels` overrides the copy + date locale for i18n (M13); omitted = English.
 */
export function relativeTime(
  iso: string,
  now: number = Date.now(),
  labels: RelativeTimeLabels = DEFAULT_TIME_LABELS,
): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const diff = now - then;
  if (diff < min) return labels.now;
  if (diff < hr) return labels.minutesAgo.replace("{count}", String(Math.floor(diff / min)));
  if (diff < day) return labels.hoursAgo.replace("{count}", String(Math.floor(diff / hr)));
  const days = Math.floor(diff / day);
  if (days === 1) return labels.yesterday;
  if (days < 7) return new Date(then).toLocaleDateString(labels.locale, { weekday: "short" });
  if (days < 14) return labels.lastWeek;
  return new Date(then).toLocaleDateString(labels.locale, { month: "short", day: "numeric" });
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
  /** "Recent" group label (i18n M13). Defaults to English. */
  recentLabel?: string;
  /** Accessible label for the history nav (i18n M13). Defaults to English. */
  recentAriaLabel?: string;
  /** Empty-state note (i18n M13). Defaults to English. */
  emptyLabel?: string;
  /** Accessible label for the unread dot (i18n M13). Defaults to English. */
  unreadLabel?: string;
  /** Locale-aware copy for the relative timestamps (i18n M13). Defaults to English. */
  timeLabels?: RelativeTimeLabels;
}

/** Skeleton placeholder rows (M12.9.4) shown while the first page of history loads. */
function ConversationListSkeleton() {
  return (
    <div className="chat-convos-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="chat-convo-skel">
          <Skeleton className="chat-convo-skel-avatar" />
          <div className="chat-convo-skel-lines">
            <Skeleton className="chat-convo-skel-title" />
            <Skeleton className="chat-convo-skel-time" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The dark-rail conversation history list (M12.2.3) — a "RECENT" `.navgroup` label over
 * `.navitem` rows, each with an expert-colored `.avatar` (initials), a truncated title, a
 * relative timestamp, and an optional unread dot. The active conversation gets `.navitem.active`.
 * While the first page loads (M12.9.4) the rows are shimmering skeletons instead of a bare note.
 * Presentational only: the chat page loads the history API (M3.2), resolves expert names, sorts
 * most-recent-first, and passes the rows in; choosing one fires `onSelect` so the page opens it.
 */
export function ChatConversationList({
  items,
  activeId,
  onSelect,
  loading = false,
  recentLabel = "Recent",
  recentAriaLabel = "Recent conversations",
  emptyLabel = "No conversations yet.",
  unreadLabel = "Unread",
  timeLabels,
}: ChatConversationListProps) {
  return (
    <nav className="chat-convos" aria-label={recentAriaLabel} aria-busy={loading || undefined}>
      <div className="navgroup">{recentLabel}</div>
      {items.length === 0 ? (
        loading ? (
          <ConversationListSkeleton />
        ) : (
          <p className="chat-convos-empty muted">{emptyLabel}</p>
        )
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
                <span className="chat-convo-time">
                  {relativeTime(item.updatedAt, Date.now(), timeLabels)}
                </span>
              </span>
              {item.unread && <span className="chat-convo-dot" aria-label={unreadLabel} />}
            </button>
          );
        })
      )}
    </nav>
  );
}
