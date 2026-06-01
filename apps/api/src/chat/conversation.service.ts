import { Injectable, NotFoundException } from "@nestjs/common";
import { estimateTokens } from "@expertos/ai";
import type { ChatMessage } from "@expertos/ai";
import type {
  ChatCitationDto,
  ConversationDetailDto,
  ConversationListQueryInput,
  ConversationSearchQueryInput,
  ConversationSearchResultDto,
  ConversationSummaryDto,
  LanguageValue,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/**
 * Conversation context-window policy (Open Decision #8, resolved in M3.5). Long multi-turn chats
 * must not grow the prompt — and its per-answer cost — without bound, so {@link
 * ConversationService.loadHistory} replays only the most recent turns that fit inside a fixed
 * **token budget** rather than a fixed message count.
 *
 * Decisions:
 * 1. **Budget by estimated tokens, not message count.** Ten short messages and ten long ones cost
 *    very differently; bounding tokens is what actually caps the prompt size and spend. The window
 *    is the most-recent messages whose combined estimate fits {@link HISTORY_TOKEN_BUDGET}.
 * 2. **The estimate is deterministic and offline** — it reuses {@link estimateTokens} (the same
 *    word→token heuristic that sizes ingestion chunks), so windowing itself costs nothing and never
 *    makes an LLM call. The real tokenizer can replace it later in one place (`@expertos/ai`).
 * 3. **Whole messages, newest-first, always ≥ the latest message.** A message is kept in full or
 *    not at all (never half a turn), and the single most-recent message is always carried even if
 *    it alone exceeds the budget, so an immediate follow-up never loses its antecedent.
 * 4. **A hard row ceiling backstops the DB read** ({@link HISTORY_MAX_MESSAGES}) so a pathological
 *    burst of tiny messages can't make the query scan an unbounded number of rows before the
 *    token budget trims them.
 *
 * Deferred (documented seam, not built): LLM **summarization** of turns that fall outside the
 * window. Truncation is the M3.5 policy; if summarization lands later it must run on a cheap model
 * and, critically, must NOT summarize away a concierge "inject corrected answer into context"
 * edit (M9). Because this window keeps the *most recent* turns and a concierge correction enters as
 * recent context, truncation of older turns is already safe for that mechanism today.
 */
const HISTORY_TOKEN_BUDGET = 1500;

/** Hard backstop on rows fetched for the history window — see {@link HISTORY_TOKEN_BUDGET}. */
const HISTORY_MAX_MESSAGES = 40;

/** Max characters of a chunk persisted as a citation `quote` preview (full text lives on the chunk). */
const QUOTE_PREVIEW_CHARS = 500;

/**
 * Max characters of an auto-derived conversation title (M3.2). Long enough to be meaningful in a
 * history list, short enough not to wrap; a longer first question is truncated on a word boundary
 * with an ellipsis.
 */
const TITLE_MAX_CHARS = 80;

/** Prisma `select` that yields exactly a {@link ConversationSummaryDto}. */
const CONVERSATION_SUMMARY_SELECT = {
  id: true,
  title: true,
  expertId: true,
  language: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ConversationSelect;

/** The row shape {@link CONVERSATION_SUMMARY_SELECT} returns. */
interface ConversationSummaryRow {
  id: string;
  title: string | null;
  expertId: string | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw row shape from the full-text {@link ConversationService.search} query. */
interface ConversationSearchRow {
  id: string;
  title: string | null;
  expert_id: string | null;
  language: string;
  created_at: Date;
  updated_at: Date;
  /** Best-matching message id, or null when only the title matched. */
  message_id: string | null;
  /** `ts_headline` excerpt of the matching message, or null when only the title matched. */
  snippet: string | null;
}

/** A resolved source for a finished answer — the prompt builder's citation list, in marker order. */
interface TurnCitation {
  /**
   * The true marker the model wrote (M4.1's `ResolvedCitation.ordinal`), NOT a loop index. The M4.1
   * builder may return a sparse list (e.g. a lone `[2]`), so persisting the marker is what lets the
   * M4.2 read path re-hydrate citations whose ordinal still matches the answer prose.
   */
  ordinal: number;
  /** Knowledge-chunk id; empty for an upload citation (which provenances via `uploadChunkId`). */
  chunkId: string;
  /** Knowledge document-version id; empty for an upload citation. */
  documentVersionId: string;
  /** `upload_chunk` id for an upload citation (M5.4); absent for a knowledge citation. */
  uploadChunkId?: string;
  content: string;
}

/** Everything needed to persist one completed chat turn (user question + grounded answer). */
export interface ConversationTurn {
  /** Continue this conversation, or start a new one when omitted. */
  conversationId?: string;
  /** Voice attribution of the answer, persisted on a new conversation. */
  expertId?: string;
  language: LanguageValue;
  userText: string;
  assistant: {
    content: string;
    /** `document_version` ids whose chunks grounded the answer (provenance). */
    sourceVersionIds: string[];
    model: string;
    confidence: number | null;
    /** Citation list in marker order; `citations[i]` is marker `[i + 1]`. */
    citations: TurnCitation[];
  };
}

interface PersistedTurn {
  conversationId: string;
  /** The persisted assistant message id. */
  messageId: string;
}

/**
 * Owns chat persistence + context loading (M3.1). Conversations are `user_scoped` and messages
 * are `tenant_only` under Postgres RLS, so every read/write runs inside {@link RlsService.run}
 * (directive §4.21): loading a conversation the acting user doesn't own returns nothing, and a
 * full turn (user message + assistant message + citations, and the conversation row itself for a
 * new chat) is written in a single transaction so a mid-stream failure can't leave a dangling
 * user message without its answer.
 */
@Injectable()
export class ConversationService {
  constructor(private readonly rls: RlsService) {}

  /**
   * Replays the most recent turns of a conversation as prompt context, oldest-first, excluding any
   * system rows. The window is bounded by a token budget rather than a fixed message count — see
   * {@link HISTORY_TOKEN_BUDGET} for the full Open Decision #8 policy. Throws {@link
   * NotFoundException} when the conversation does not belong to the acting user (RLS makes a peer's
   * conversation invisible).
   */
  async loadHistory(user: AuthUser, conversationId: string): Promise<ChatMessage[]> {
    return this.rls.run(user, async (tx) => {
      await this.requireConversation(tx, conversationId);
      // Fetch newest-first (capped) and accumulate whole messages until the next one would exceed
      // the token budget; the most recent message is always kept (see HISTORY_TOKEN_BUDGET).
      const rows = await tx.message.findMany({
        where: { conversationId, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_MAX_MESSAGES,
        select: { id: true, role: true, content: true },
      });
      const windowed: typeof rows = [];
      let tokens = 0;
      for (const row of rows) {
        const cost = estimateTokens(row.content);
        if (windowed.length > 0 && tokens + cost > HISTORY_TOKEN_BUDGET) {
          break;
        }
        tokens += cost;
        windowed.push(row);
      }

      // Concierge reviewer-feedback flywheel — immediate context injection (M9.4): when a human
      // reviewer edited one of these assistant answers, replay the *corrected* text into the prompt
      // history so the next turn reflects it. The displayed message is untouched (visible delivery is
      // M9.3); this only substitutes the context the model sees.
      const revisions = await this.loadEditedRevisions(
        tx,
        windowed.filter((row) => row.role === "assistant").map((row) => row.id),
      );

      return windowed
        .reverse()
        .map((row) => ({
          role: row.role as ChatMessage["role"],
          content: revisions.get(row.id) ?? row.content,
        }));
    });
  }

  /**
   * Maps assistant message id → the latest reviewer-edited answer for it (M9.4 context injection).
   * `review_responses` is tenant-scoped and the owning `human_review_requests` are the acting user's
   * own (the answers under review are in their conversation), so this read is safe under the user's
   * own RLS context. Only edited responses with a real revision substitute.
   */
  private async loadEditedRevisions(
    tx: Prisma.TransactionClient,
    assistantMessageIds: string[],
  ): Promise<Map<string, string>> {
    const revisions = new Map<string, string>();
    if (assistantMessageIds.length === 0) {
      return revisions;
    }
    const responses = await tx.reviewResponse.findMany({
      where: {
        edited: true,
        revisedAnswer: { not: null },
        reviewRequest: { messageId: { in: assistantMessageIds } },
      },
      orderBy: { createdAt: "desc" },
      select: { revisedAnswer: true, reviewRequest: { select: { messageId: true } } },
    });
    // Ordered newest-first, so the first revision seen per message is the latest.
    for (const response of responses) {
      const messageId = response.reviewRequest.messageId;
      if (response.revisedAnswer !== null && !revisions.has(messageId)) {
        revisions.set(messageId, response.revisedAnswer);
      }
    }
    return revisions;
  }

  /** Persists a completed turn, creating the conversation when this is the first turn. */
  async persistTurn(user: AuthUser, turn: ConversationTurn): Promise<PersistedTurn> {
    return this.rls.run(user, async (tx) => {
      const conversationId = turn.conversationId
        ? (await this.requireConversation(tx, turn.conversationId)).id
        : (
            await tx.conversation.create({
              data: {
                tenantId: user.tenantId,
                userId: user.id,
                expertId: turn.expertId ?? null,
                language: turn.language,
                // Auto-title from the first question (M3.2); the user can rename it later.
                title: deriveTitle(turn.userText),
              },
              select: { id: true },
            })
          ).id;

      await tx.message.create({
        data: {
          tenantId: user.tenantId,
          conversationId,
          role: "user",
          content: turn.userText,
        },
      });

      const assistant = await tx.message.create({
        data: {
          tenantId: user.tenantId,
          conversationId,
          role: "assistant",
          content: turn.assistant.content,
          sourceVersionIds: turn.assistant.sourceVersionIds,
          model: turn.assistant.model,
          confidence: turn.assistant.confidence,
        },
        select: { id: true },
      });

      for (const citation of turn.assistant.citations) {
        await tx.citation.create({
          data: {
            tenantId: user.tenantId,
            messageId: assistant.id,
            // Persist the true marker ordinal, not the loop index — a sparse citation list (M4.1)
            // must keep `ordinal` aligned with the `[n]` markers in the persisted answer text.
            ordinal: citation.ordinal,
            // Knowledge citations carry uuid provenance; an upload citation (M5.4) provenances via
            // `uploadChunkId` and leaves these empty — coalesce "" → null so the uuid columns stay
            // valid (an empty string is not a uuid).
            chunkId: citation.chunkId || null,
            documentVersionId: citation.documentVersionId || null,
            uploadChunkId: citation.uploadChunkId ?? null,
            quote: citation.content.slice(0, QUOTE_PREVIEW_CHARS),
          },
        });
      }

      return { conversationId, messageId: assistant.id };
    });
  }

  /**
   * Lists the acting user's conversations, most-recent-activity first (M3.2 history). RLS scopes
   * `conversations` to the owning user, so no `where` filter is needed for isolation.
   */
  async list(
    user: AuthUser,
    query: ConversationListQueryInput,
  ): Promise<ConversationSummaryDto[]> {
    const rows = await this.rls.run(user, (tx) =>
      tx.conversation.findMany({
        select: CONVERSATION_SUMMARY_SELECT,
        orderBy: { updatedAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
    );
    return (rows as ConversationSummaryRow[]).map(toConversationSummary);
  }

  /**
   * Returns one conversation with its full user/assistant transcript (M3.2 detail view), oldest
   * message first. Throws {@link NotFoundException} when the conversation is not the acting user's
   * (RLS makes a peer's conversation invisible).
   */
  async get(user: AuthUser, conversationId: string): Promise<ConversationDetailDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.conversation.findUnique({
        where: { id: conversationId },
        select: CONVERSATION_SUMMARY_SELECT,
      })) as ConversationSummaryRow | null;
      if (!row) {
        throw new NotFoundException("conversation not found");
      }
      const messages = await tx.message.findMany({
        where: { conversationId, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
      });
      const citationsByMessage = await this.loadCitations(
        tx,
        messages.filter((m) => m.role === "assistant").map((m) => m.id),
      );
      return {
        ...toConversationSummary(row),
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt.toISOString(),
          citations: citationsByMessage.get(m.id) ?? [],
        })),
      };
    });
  }

  /** Renames a conversation, overriding the auto-title (M3.2). Ownership enforced by RLS. */
  async rename(
    user: AuthUser,
    conversationId: string,
    title: string,
  ): Promise<ConversationSummaryDto> {
    return this.rls.run(user, async (tx) => {
      await this.requireConversation(tx, conversationId);
      const row = (await tx.conversation.update({
        where: { id: conversationId },
        data: { title },
        select: CONVERSATION_SUMMARY_SELECT,
      })) as ConversationSummaryRow;
      return toConversationSummary(row);
    });
  }

  /**
   * Full-text search over the acting user's conversations (M3.3): a conversation matches when its
   * title OR any of its user/assistant messages match the query, ranked by `ts_rank` (best message
   * hit or the title hit, whichever is stronger) then most-recent activity. Each hit carries a
   * `ts_headline` snippet of its best-matching message (null when only the title matched).
   *
   * Like the M1.2 keyword retrieval path this is raw SQL — `ts_rank`/`ts_headline` have no Prisma
   * Client expression — run inside {@link RlsService.run} so Postgres RLS does the isolation: a
   * `conversations` row is `user_scoped` (only the owner's chats survive the join) and `messages`
   * is `tenant_only`, so the join's intersection is exactly the acting user's own messages. The
   * `'simple'` text-search config (no English stemming) keeps Vietnamese undistorted (OD #9), and
   * the query text is a bound parameter, never interpolated (directive §1).
   */
  async search(
    user: AuthUser,
    query: ConversationSearchQueryInput,
  ): Promise<ConversationSearchResultDto[]> {
    const rows = await this.rls.run(user, (tx) =>
      tx.$queryRawUnsafe<ConversationSearchRow[]>(SEARCH_SQL, query.q, query.limit, query.offset),
    );
    return (rows as ConversationSearchRow[]).map(toConversationSearchResult);
  }

  /**
   * Re-hydrates the persisted citations for a set of assistant messages (M4.2 read path), grouped
   * by message id and ascending by marker ordinal. The stored `ordinal` is the true `[n]` marker
   * (M4.1 — possibly sparse), carried verbatim so a history view renders the same sources drawer
   * the live turn showed. `kind` is derived from which chunk the row resolved to: an `uploadChunkId`
   * marks a user-uploaded source (info-blue, M5), otherwise it is published knowledge (crimson).
   */
  private async loadCitations(
    tx: Prisma.TransactionClient,
    assistantMessageIds: string[],
  ): Promise<Map<string, ChatCitationDto[]>> {
    const byMessage = new Map<string, ChatCitationDto[]>();
    if (assistantMessageIds.length === 0) {
      return byMessage;
    }
    const rows = await tx.citation.findMany({
      where: { messageId: { in: assistantMessageIds } },
      orderBy: { ordinal: "asc" },
      select: {
        messageId: true,
        ordinal: true,
        chunkId: true,
        documentVersionId: true,
        uploadChunkId: true,
        quote: true,
      },
    });
    for (const r of rows) {
      const list = byMessage.get(r.messageId) ?? [];
      list.push({
        ordinal: r.ordinal,
        // Knowledge citations always carry both ids; the `?? ""` guards the nullable columns the
        // schema shares with M5 upload citations (which provenance via `uploadChunkId` instead).
        chunkId: r.chunkId ?? "",
        documentVersionId: r.documentVersionId ?? "",
        quote: r.quote ?? undefined,
        kind: r.uploadChunkId ? "upload" : "knowledge",
      });
      byMessage.set(r.messageId, list);
    }
    return byMessage;
  }

  private async requireConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<{ id: string }> {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundException("conversation not found");
    }
    return conversation;
  }
}

/**
 * Full-text conversation-search query (M3.3). `$1` = query text, `$2` = limit, `$3` = offset.
 *
 * The query is parsed once (the `q` CTE). For each conversation a LATERAL subquery picks its single
 * strongest-matching user/assistant message (rank + a `ts_headline` snippet); a conversation is a
 * hit when its title matches or that subquery found a message. Rank is the stronger of the title
 * hit and the best message hit, breaking ties by recency. `ts_headline` is configured with
 * guillemet selectors (`StartSel=«,StopSel=»`) instead of the default `<b>` tags so the snippet is
 * never HTML (directive §1 — see {@link ConversationSearchResultDto}). The enum literals are cast
 * to `message_role` explicitly. RLS scopes both tables; no `tenant_id`/`user_id` predicate appears.
 */
const SEARCH_SQL = `
  WITH q AS (SELECT websearch_to_tsquery('simple', $1) AS query)
  SELECT
    c.id, c.title, c.expert_id, c.language, c.created_at, c.updated_at,
    best.message_id,
    best.snippet,
    GREATEST(
      ts_rank(to_tsvector('simple', coalesce(c.title, '')), q.query),
      coalesce(best.rank, 0)
    ) AS rank
  FROM conversations c
  CROSS JOIN q
  LEFT JOIN LATERAL (
    SELECT
      m.id AS message_id,
      ts_rank(to_tsvector('simple', m.content), q.query) AS rank,
      ts_headline(
        'simple', m.content, q.query,
        'StartSel=«,StopSel=»,MaxFragments=1,MaxWords=18,MinWords=5'
      ) AS snippet
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.role IN ('user'::message_role, 'assistant'::message_role)
      AND to_tsvector('simple', m.content) @@ q.query
    ORDER BY rank DESC
    LIMIT 1
  ) best ON true
  WHERE to_tsvector('simple', coalesce(c.title, '')) @@ q.query
     OR best.message_id IS NOT NULL
  ORDER BY rank DESC, c.updated_at DESC
  LIMIT $2 OFFSET $3`;

/** Flatten a {@link ConversationSearchRow} into the public {@link ConversationSearchResultDto}. */
function toConversationSearchResult(row: ConversationSearchRow): ConversationSearchResultDto {
  return {
    conversation: {
      id: row.id,
      title: row.title,
      expertId: row.expert_id,
      language: row.language as LanguageValue,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    snippet: row.snippet,
    messageId: row.message_id,
  };
}

/** Flatten a {@link CONVERSATION_SUMMARY_SELECT} row into the public {@link ConversationSummaryDto}. */
function toConversationSummary(row: ConversationSummaryRow): ConversationSummaryDto {
  return {
    id: row.id,
    title: row.title,
    expertId: row.expertId,
    language: row.language as LanguageValue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Derives a conversation title from its first question (M3.2): collapse whitespace, then truncate
 * on a word boundary with an ellipsis if it exceeds {@link TITLE_MAX_CHARS}. Deterministic and
 * offline (no LLM call) — a meaningful default the user can always rename.
 */
function deriveTitle(firstQuestion: string): string {
  const cleaned = firstQuestion.replace(/\s+/g, " ").trim();
  if (cleaned.length <= TITLE_MAX_CHARS) {
    return cleaned;
  }
  const clipped = cleaned.slice(0, TITLE_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(" ");
  // Fall back to a hard cut when the first "word" alone already exceeds the limit.
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}
