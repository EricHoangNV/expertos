import { Injectable, NotFoundException } from "@nestjs/common";
import type { ChatMessage } from "@expertos/ai";
import type {
  ConversationDetailDto,
  ConversationListQueryInput,
  ConversationSummaryDto,
  LanguageValue,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/**
 * Number of trailing messages replayed as conversation context (M3.1). This is a deliberate
 * INTERIM cap so a long chat can't grow the prompt — and its cost — without bound. Replacing it
 * with a token-budget / summarization policy is Open Decision #8, scheduled for M3.5.
 */
const HISTORY_LIMIT = 10;

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

/** A resolved source for a finished answer — the prompt builder's citation list, in marker order. */
interface TurnCitation {
  chunkId: string;
  documentVersionId: string;
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
   * Replays the most recent turns of a conversation as prompt context, oldest-first, excluding
   * any system rows. Capped at {@link HISTORY_LIMIT} (interim — see Open Decision #8 / M3.5).
   * Throws {@link NotFoundException} when the conversation does not belong to the acting user
   * (RLS makes a peer's conversation invisible).
   */
  async loadHistory(user: AuthUser, conversationId: string): Promise<ChatMessage[]> {
    return this.rls.run(user, async (tx) => {
      await this.requireConversation(tx, conversationId);
      const rows = await tx.message.findMany({
        where: { conversationId, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: { role: true, content: true },
      });
      return rows
        .reverse()
        .map((row) => ({ role: row.role as ChatMessage["role"], content: row.content }));
    });
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

      for (let i = 0; i < turn.assistant.citations.length; i++) {
        const citation = turn.assistant.citations[i];
        await tx.citation.create({
          data: {
            tenantId: user.tenantId,
            messageId: assistant.id,
            ordinal: i + 1,
            chunkId: citation.chunkId,
            documentVersionId: citation.documentVersionId,
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
      return {
        ...toConversationSummary(row),
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt.toISOString(),
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
