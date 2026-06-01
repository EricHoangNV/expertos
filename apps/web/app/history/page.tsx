"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input } from "@expertos/ui";
import type {
  ConversationDetailDto,
  ConversationSearchResultDto,
  ConversationSummaryDto,
  SavedAnswerDto,
} from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { AnswerView } from "../../src/components/answer-view";
import {
  createSavedAnswer,
  getConversation,
  listConversations,
  listSavedAnswers,
  removeSavedAnswer,
  renameConversation,
  searchConversations,
} from "../../src/lib/history-client";

/** How many list/search rows to fetch per page. */
const PAGE = 20;

/** Formats an ISO-8601 timestamp for display. */
function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** A conversation's title, falling back to a placeholder for the rare untitled (pre-auto-title) row. */
function titleOf(c: { title: string | null }): string {
  return c.title ?? "Untitled conversation";
}

/** The full transcript of a selected conversation, with inline-edit rename + per-answer bookmark. */
function ConversationDetail({
  detail,
  onBack,
  onRenamed,
}: {
  detail: ConversationDetailDto;
  onBack: () => void;
  onRenamed: (updated: ConversationSummaryDto) => void;
}) {
  const { getIdToken } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(detail.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const submitRename = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in.");
        return;
      }
      const updated = await renameConversation(token, detail.id, trimmed);
      onRenamed(updated);
      setEditing(false);
    } catch {
      setError("Couldn't rename — please try again.");
    } finally {
      setBusy(false);
    }
  }, [getIdToken, detail.id, title, onRenamed]);

  const save = useCallback(
    async (messageId: string) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to save answers.");
          return;
        }
        await createSavedAnswer(token, messageId);
        setSavedIds((prev) => new Set(prev).add(messageId));
      } catch {
        setError("Couldn't save that answer — please try again.");
      }
    },
    [getIdToken],
  );

  return (
    <>
      <div className="row gap2 wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        {editing ? (
          <>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              maxLength={100}
              aria-label="Conversation title"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitRename()}
              disabled={busy || !title.trim()}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <h2>{titleOf(detail)}</h2>
            <Button variant="subtle" size="sm" onClick={() => setEditing(true)}>
              Rename
            </Button>
          </>
        )}
      </div>
      <span className="muted">Last activity {when(detail.updatedAt)}</span>
      {error && <Badge tone="red">{error}</Badge>}

      <div>
        {detail.messages.map((m) => (
          <Card key={m.id} className="card-pad">
            <Badge tone={m.role === "user" ? "info" : "green"}>
              {m.role === "user" ? "You" : "Assistant"}
            </Badge>
            {m.role === "assistant" ? (
              <>
                <AnswerView content={m.content} citations={m.citations} interactive />
                {savedIds.has(m.id) ? (
                  <Badge tone="green">Saved ★</Badge>
                ) : (
                  <div className="row gap2 wrap">
                    <Button variant="subtle" size="sm" onClick={() => void save(m.id)}>
                      ☆ Save answer
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p>{m.content}</p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

/** The bookmarked-answers panel: list + remove, with a jump into the owning conversation. */
function SavedAnswers({ onOpen }: { onOpen: (conversationId: string) => void }) {
  const { getIdToken } = useAuth();
  const [items, setItems] = useState<SavedAnswerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) return;
      setItems(await listSavedAnswers(token, { limit: PAGE, offset: 0 }));
    } catch {
      setError("Couldn't load saved answers.");
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: string) => {
      try {
        const token = await getIdToken();
        if (!token) return;
        await removeSavedAnswer(token, id);
        setItems((prev) => prev.filter((i) => i.id !== id));
      } catch {
        setError("Couldn't remove that bookmark.");
      }
    },
    [getIdToken],
  );

  return (
    <Card className="card-pad">
      <span className="label">Saved answers</span>
      {loading && <Badge tone="info">Loading…</Badge>}
      {error && <Badge tone="red">{error}</Badge>}
      {!loading && items.length === 0 && (
        <p className="muted">No saved answers yet. Bookmark an answer to keep it here.</p>
      )}
      {items.map((item) => (
        <div key={item.id} className="row gap2 wrap">
          <Button variant="ghost" size="sm" onClick={() => onOpen(item.conversationId)}>
            Open conversation
          </Button>
          {item.note && <span className="muted">{item.note}</span>}
          <span className="muted">{when(item.createdAt)}</span>
          <Button variant="subtle" size="sm" onClick={() => void remove(item.id)}>
            Remove
          </Button>
        </div>
      ))}
    </Card>
  );
}

export default function HistoryPage() {
  const { user, getIdToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSearchResultDto[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [detail, setDetail] = useState<ConversationDetailDto | null>(null);

  const loadPage = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in to view your history.");
          return;
        }
        const page = await listConversations(token, { limit: PAGE, offset: nextOffset });
        setConversations((prev) => (nextOffset === 0 ? page : [...prev, ...page]));
        setOffset(nextOffset + page.length);
        setHasMore(page.length === PAGE);
      } catch {
        setError("Couldn't load your conversations — please try again.");
      } finally {
        setLoading(false);
      }
    },
    [getIdToken],
  );

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void loadPage(0);
  }, [user, loadPage]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to search.");
        return;
      }
      setResults(await searchConversations(token, q, { limit: PAGE, offset: 0 }));
    } catch {
      setError("Search failed — please try again.");
    } finally {
      setSearching(false);
    }
  }, [getIdToken, query]);

  const open = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError("Please sign in.");
          return;
        }
        setDetail(await getConversation(token, id));
      } catch {
        setError("Couldn't open that conversation — please try again.");
      }
    },
    [getIdToken],
  );

  const onRenamed = useCallback((updated: ConversationSummaryDto) => {
    setDetail((prev) => (prev ? { ...prev, title: updated.title } : prev));
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)));
  }, []);

  if (!user) {
    return (
      <main className="card card-pad">
        <h1>History</h1>
        <Badge tone="info">Please sign in on the home page to view your history.</Badge>
      </main>
    );
  }

  if (detail) {
    return (
      <main className="card card-pad">
        <h1>History</h1>
        <ConversationDetail detail={detail} onBack={() => setDetail(null)} onRenamed={onRenamed} />
      </main>
    );
  }

  return (
    <main className="card card-pad">
      <h1>History</h1>

      <Field label="Search your conversations" htmlFor="q">
        <div className="row gap2 wrap">
          <Input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            maxLength={200}
            placeholder="Search titles and messages…"
          />
          <Button variant="primary" onClick={() => void runSearch()} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
          {results !== null && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </Field>

      {error && <Badge tone="red">{error}</Badge>}

      {results !== null ? (
        <Card className="card-pad">
          <span className="label">Search results</span>
          {results.length === 0 && <p className="muted">No conversations matched.</p>}
          {results.map((r) => (
            <div key={r.conversation.id} className="col gap1">
              <Button variant="ghost" size="sm" onClick={() => void open(r.conversation.id)}>
                {titleOf(r.conversation)}
              </Button>
              {r.snippet && <span className="source-quote">{r.snippet}</span>}
            </div>
          ))}
        </Card>
      ) : (
        <Card className="card-pad">
          <span className="label">Recent conversations</span>
          {loading && conversations.length === 0 && <Badge tone="info">Loading…</Badge>}
          {!loading && conversations.length === 0 && (
            <p className="muted">No conversations yet. Start one from the Chat page.</p>
          )}
          {conversations.map((c) => (
            <div key={c.id} className="row gap2 wrap">
              <Button variant="ghost" size="sm" onClick={() => void open(c.id)}>
                {titleOf(c)}
              </Button>
              <span className="muted">{when(c.updatedAt)}</span>
            </div>
          ))}
          {hasMore && (
            <Button variant="subtle" onClick={() => void loadPage(offset)} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          )}
        </Card>
      )}

      <SavedAnswers onOpen={open} />
    </main>
  );
}
