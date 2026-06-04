import { cx } from "./cx";
import { Input } from "./Field";

/** One full-text search hit (M3.3): the conversation plus a highlighted excerpt. */
export interface ChatSearchResultItem {
  /** Conversation id — the {@link ChatSearchProps.onSelect} target. */
  id: string;
  /** Display title (the caller supplies a fallback for null/untitled conversations). */
  title: string;
  /**
   * Highlighted excerpt of the best-matching message, guillemet-wrapped plain text
   * (`«match»`, never HTML — safe to render as text per directive §1), or null when
   * only the conversation title matched.
   */
  snippet: string | null;
}

export interface ChatSearchProps {
  /** Controlled query value. */
  query: string;
  /** Fired on each keystroke — the caller debounces and calls the search API (M3.3). */
  onQueryChange: (query: string) => void;
  /** Search hits for the current query (caller-provided). */
  results: ChatSearchResultItem[];
  /** True while a search request is in flight — surfaces a "Searching…" note. */
  searching?: boolean;
  /** Fired when a result is chosen — the caller loads that conversation. */
  onSelect: (conversationId: string) => void;
  /** Id of the currently open conversation, highlighted in the results. */
  activeId?: string;
  /** Placeholder + accessible label for the search input (i18n M13). Defaults to English. */
  placeholder?: string;
  /** "Searching…" in-flight note (i18n M13). Defaults to English. */
  searchingLabel?: string;
  /** Empty-results note (i18n M13). Defaults to English. */
  noResultsLabel?: string;
}

/**
 * Conversation search input for the dark chat sidebar (M12.2.2) — a controlled `.input`
 * on the dark rail ("Search all messages…") wired to the existing full-text search API
 * (M3.3, `GET /conversations/search`). Presentational only: the chat page owns the query
 * state, debounces it, calls the API, and passes the hits back as `results`. Below the
 * field, matching conversations render with their highlighted excerpt; choosing one fires
 * `onSelect` so the page can open it. The results region only appears once the user has
 * typed, keeping the resting sidebar clean for the RECENT list (M12.2.3).
 */
export function ChatSearch({
  query,
  onQueryChange,
  results,
  searching = false,
  onSelect,
  activeId,
  placeholder = "Search all messages…",
  searchingLabel = "Searching…",
  noResultsLabel = "No matching conversations.",
}: ChatSearchProps) {
  const active = query.trim().length > 0;
  return (
    <div className="chat-search">
      <div className="chat-search-field">
        <svg
          className="ic"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16.5 16.5L21 21"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <Input
          className="chat-search-input"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>
      {active && (
        <div className="chat-search-results">
          {results.length === 0 ? (
            <p className="chat-search-empty muted">
              {searching ? searchingLabel : noResultsLabel}
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cx("chat-search-item", r.id === activeId && "active")}
                onClick={() => onSelect(r.id)}
              >
                <span className="chat-search-title">{r.title}</span>
                {r.snippet && <span className="chat-search-snippet">{r.snippet}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
