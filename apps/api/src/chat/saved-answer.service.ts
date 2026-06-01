import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  SavedAnswerCreateInput,
  SavedAnswerDto,
  SavedAnswerListQueryInput,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** Prisma `select` that yields exactly a {@link SavedAnswerDto}. */
const SAVED_ANSWER_SELECT = {
  id: true,
  conversationId: true,
  messageId: true,
  note: true,
  createdAt: true,
} satisfies Prisma.SavedAnswerSelect;

/** The row shape {@link SAVED_ANSWER_SELECT} returns. */
interface SavedAnswerRow {
  id: string;
  conversationId: string;
  messageId: string;
  note: string | null;
  createdAt: Date;
}

/**
 * Owns saved-answer (bookmark) persistence (M3.2, PRD §"History & retention"). A user bookmarks an
 * assistant answer for later; `saved_answers` is `user_scoped` under Postgres RLS (directive §4.21),
 * so every read/write runs inside {@link RlsService.run} and a peer's bookmarks are invisible.
 *
 * Bookmarking takes only a `messageId`: the owning conversation is derived server-side from the
 * message and its ownership re-checked (directive §26), because `messages` is `tenant_only` under
 * RLS (any user in the tenant can read any message) while `conversations` is `user_scoped` — so the
 * conversation lookup is the boundary that stops a user from bookmarking an answer in a chat they
 * don't own. Only `assistant` messages are bookmarkable (a "saved answer", not a saved question).
 */
@Injectable()
export class SavedAnswerService {
  constructor(private readonly rls: RlsService) {}

  /** Bookmark an assistant answer the acting user owns. */
  async create(
    user: AuthUser,
    input: SavedAnswerCreateInput,
  ): Promise<SavedAnswerDto> {
    return this.rls.run(user, async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: input.messageId },
        select: { id: true, role: true, conversationId: true },
      });
      if (!message || message.role !== "assistant") {
        throw new NotFoundException("answer not found");
      }

      // `conversations` is user_scoped: this returns null unless the actor owns the chat, which is
      // the real ownership boundary (the message row itself is only tenant-scoped).
      const conversation = await tx.conversation.findUnique({
        where: { id: message.conversationId },
        select: { id: true },
      });
      if (!conversation) {
        throw new NotFoundException("answer not found");
      }

      const existing = await tx.savedAnswer.findUnique({
        where: { userId_messageId: { userId: user.id, messageId: input.messageId } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException("answer already saved");
      }

      const row = (await tx.savedAnswer.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          conversationId: message.conversationId,
          messageId: input.messageId,
          note: input.note ?? null,
        },
        select: SAVED_ANSWER_SELECT,
      })) as SavedAnswerRow;
      return toSavedAnswerDto(row);
    });
  }

  /** Lists the acting user's bookmarks, most recent first. RLS scopes to the user. */
  async list(
    user: AuthUser,
    query: SavedAnswerListQueryInput,
  ): Promise<SavedAnswerDto[]> {
    const rows = await this.rls.run(user, (tx) =>
      tx.savedAnswer.findMany({
        select: SAVED_ANSWER_SELECT,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
    );
    return (rows as SavedAnswerRow[]).map(toSavedAnswerDto);
  }

  /** Removes a bookmark. Throws {@link NotFoundException} when it isn't the acting user's. */
  async remove(user: AuthUser, id: string): Promise<void> {
    await this.rls.run(user, async (tx) => {
      const existing = await tx.savedAnswer.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException("saved answer not found");
      }
      await tx.savedAnswer.delete({ where: { id } });
    });
  }
}

/** Flatten a {@link SAVED_ANSWER_SELECT} row into the public {@link SavedAnswerDto}. */
function toSavedAnswerDto(row: SavedAnswerRow): SavedAnswerDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}
