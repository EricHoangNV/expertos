"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, formatDateTime, Input, type Locale } from "@expertos/ui";
import type {
  ConversationDetailDto,
  ConversationSearchResultDto,
  ConversationSummaryDto,
  SavedAnswerDto,
} from "@expertos/shared";
import { HIGH_STAKES_DISCLAIMERS } from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { useLocale, useT } from "../../src/lib/i18n";
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

/** Formats an ISO-8601 timestamp for display in the active locale (M13.5). */
function when(iso: string, locale: Locale): string {
  return formatDateTime(locale, iso);
}

/** A conversation's title, falling back to a (localized) placeholder for the rare untitled row. */
function titleOf(c: { title: string | null }, untitled: string): string {
  return c.title ?? untitled;
}

/** Leading chat-bubble glyph for a conversation row (M19.1.1 design parity). */
function ChatIcon() {
  return (
    <svg className="urow-ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 5h16v11H9l-4 3v-3H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Trailing affordance chevron for a clickable row (M19.1.1). */
function Chevron() {
  return (
    <svg className="urow-ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A full-width clickable conversation row (M19.1.1): a `.card` rendered as a button with a leading
 * chat icon, the title, and a trailing date + chevron. The button's accessible name is the title
 * alone (the date is decorative `aria-hidden`), so it reads cleanly to assistive tech.
 */
function ConversationRow({
  title,
  meta,
  onOpen,
}: {
  title: string;
  meta: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="card urow" aria-label={title} onClick={onOpen}>
      <ChatIcon />
      <span className="urow-title">{title}</span>
      <span className="urow-meta" aria-hidden="true">
        {meta}
      </span>
      <Chevron />
    </button>
  );
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
  const t = useT("history");
  const { locale } = useLocale();
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
        setError(t("signIn"));
        return;
      }
      const updated = await renameConversation(token, detail.id, trimmed);
      onRenamed(updated);
      setEditing(false);
    } catch {
      setError(t("renameError"));
    } finally {
      setBusy(false);
    }
  }, [getIdToken, detail.id, title, onRenamed, t]);

  const save = useCallback(
    async (messageId: string) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("saveSignIn"));
          return;
        }
        await createSavedAnswer(token, messageId);
        setSavedIds((prev) => new Set(prev).add(messageId));
      } catch {
        setError(t("saveAnswerError"));
      }
    },
    [getIdToken, t],
  );

  return (
    <>
      <div className="row gap2 wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("back")}
        </Button>
        {editing ? (
          <>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              maxLength={100}
              aria-label={t("titleAria")}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitRename()}
              disabled={busy || !title.trim()}
            >
              {t("save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <>
            <h2>{titleOf(detail, t("untitled"))}</h2>
            <Button variant="subtle" size="sm" onClick={() => setEditing(true)}>
              {t("rename")}
            </Button>
          </>
        )}
      </div>
      <span className="muted">{t("lastActivity", { when: when(detail.updatedAt, locale) })}</span>
      {error && <Badge tone="red">{error}</Badge>}

      <div>
        {detail.messages.map((m) => (
          <Card key={m.id} className="card-pad">
            <Badge tone={m.role === "user" ? "info" : "green"}>
              {m.role === "user" ? t("roleYou") : t("roleAssistant")}
            </Badge>
            {m.role === "assistant" ? (
              <>
                {m.refinedFromMessageId ? (
                  <Badge tone="info" title={t("reviewedTooltip")}>
                    {t("reviewedRefined")}
                  </Badge>
                ) : null}
                <AnswerView content={m.content} citations={m.citations} interactive />
                {m.highStakes ? (
                  <Card className="card-pad">
                    <Badge tone="amber">{t("important")}</Badge>
                    <p className="muted">{HIGH_STAKES_DISCLAIMERS[locale]}</p>
                  </Card>
                ) : null}
                {savedIds.has(m.id) ? (
                  <Badge tone="green">{t("saved")}</Badge>
                ) : (
                  <div className="row gap2 wrap">
                    <Button variant="subtle" size="sm" onClick={() => void save(m.id)}>
                      {t("saveAnswer")}
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
  const t = useT("history");
  const { locale } = useLocale();
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
      setError(t("savedLoadError"));
    } finally {
      setLoading(false);
    }
  }, [getIdToken, t]);

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
        setError(t("removeError"));
      }
    },
    [getIdToken, t],
  );

  return (
    <Card className="card-pad">
      <span className="label">{t("savedAnswers")}</span>
      {loading && <Badge tone="info">{t("loading")}</Badge>}
      {error && <Badge tone="red">{error}</Badge>}
      {!loading && items.length === 0 && (
        <p className="muted">{t("noSaved")}</p>
      )}
      {items.map((item) => (
        <div key={item.id} className="row gap2 wrap">
          <Button variant="ghost" size="sm" onClick={() => onOpen(item.conversationId)}>
            {t("openConversation")}
          </Button>
          {item.note && <span className="muted">{item.note}</span>}
          <span className="muted">{when(item.createdAt, locale)}</span>
          <Button variant="subtle" size="sm" onClick={() => void remove(item.id)}>
            {t("remove")}
          </Button>
        </div>
      ))}
    </Card>
  );
}

export default function HistoryPage() {
  const { user, getIdToken } = useAuth();
  const t = useT("history");
  const { locale } = useLocale();
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSearchResultDto[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [tab, setTab] = useState<"conversations" | "saved">("conversations");
  const [detail, setDetail] = useState<ConversationDetailDto | null>(null);

  const loadPage = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("listSignIn"));
          return;
        }
        const page = await listConversations(token, { limit: PAGE, offset: nextOffset });
        setConversations((prev) => (nextOffset === 0 ? page : [...prev, ...page]));
        setOffset(nextOffset + page.length);
        setHasMore(page.length === PAGE);
      } catch {
        setError(t("loadError"));
      } finally {
        setLoading(false);
      }
    },
    [getIdToken, t],
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
        setError(t("searchSignIn"));
        return;
      }
      setResults(await searchConversations(token, q, { limit: PAGE, offset: 0 }));
    } catch {
      setError(t("searchFailed"));
    } finally {
      setSearching(false);
    }
  }, [getIdToken, query, t]);

  const open = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setError(t("signIn"));
          return;
        }
        setDetail(await getConversation(token, id));
      } catch {
        setError(t("openError"));
      }
    },
    [getIdToken, t],
  );

  const onRenamed = useCallback((updated: ConversationSummaryDto) => {
    setDetail((prev) => (prev ? { ...prev, title: updated.title } : prev));
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)));
  }, []);

  if (!user) {
    return (
      <main className="umain">
        <div className="pagehead">
          <div>
            <div className="eyebrow">{t("eyebrow")}</div>
            <h1 className="h1">{t("heading")}</h1>
          </div>
        </div>
        <Badge tone="info">{t("signInPrompt")}</Badge>
      </main>
    );
  }

  if (detail) {
    return (
      <main className="umain">
        <ConversationDetail detail={detail} onBack={() => setDetail(null)} onRenamed={onRenamed} />
      </main>
    );
  }

  return (
    <main className="umain">
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("heading")}</h1>
        </div>
        <div className="seg" role="tablist" aria-label={t("heading")}>
          {(["conversations", "saved"] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              role="tab"
              aria-selected={tab === tabKey}
              className={tab === tabKey ? "active" : undefined}
              onClick={() => setTab(tabKey)}
            >
              {tabKey === "conversations" ? t("tabConversations") : t("tabSaved")}
            </button>
          ))}
        </div>
      </div>

      {error && <Badge tone="red">{error}</Badge>}

      {tab === "saved" ? (
        <SavedAnswers onOpen={open} />
      ) : (
        <div className="col gap4">
          <div className="row gap2 wrap">
            <Input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              maxLength={200}
              aria-label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              style={{ flex: 1 }}
            />
            <Button variant="primary" onClick={() => void runSearch()} disabled={searching}>
              {searching ? t("searching") : t("search")}
            </Button>
            {results !== null && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setResults(null);
                }}
              >
                {t("clear")}
              </Button>
            )}
          </div>

          {results !== null ? (
            <div className="col gap2">
              <span className="label">{t("searchResults")}</span>
              {results.length === 0 && <p className="muted">{t("noMatch")}</p>}
              {results.map((r) => (
                <div key={r.conversation.id} className="col gap1">
                  <ConversationRow
                    title={titleOf(r.conversation, t("untitled"))}
                    meta={when(r.conversation.updatedAt, locale)}
                    onOpen={() => void open(r.conversation.id)}
                  />
                  {r.snippet && <span className="source-quote">{r.snippet}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="col gap2">
              <span className="label">{t("recentConversations")}</span>
              {loading && conversations.length === 0 && <Badge tone="info">{t("loading")}</Badge>}
              {!loading && conversations.length === 0 && (
                <p className="muted">{t("noConversations")}</p>
              )}
              {conversations.map((c) => (
                <ConversationRow
                  key={c.id}
                  title={titleOf(c, t("untitled"))}
                  meta={when(c.updatedAt, locale)}
                  onOpen={() => void open(c.id)}
                />
              ))}
              {hasMore && (
                <Button variant="subtle" onClick={() => void loadPage(offset)} disabled={loading}>
                  {loading ? t("loading") : t("loadMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
