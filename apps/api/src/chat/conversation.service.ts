import { Injectable, NotFoundException } from "@nestjs/common";
import type { ChatMessage } from "@expertos/ai";
import type { LanguageValue } from "@expertos/shared";
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
