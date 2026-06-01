import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AnswerFeedbackDto,
  AnswerFeedbackSubmitInput,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** Prisma `select` that yields exactly an {@link AnswerFeedbackDto}. */
const FEEDBACK_SELECT = {
  id: true,
  messageId: true,
  helpful: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.AnswerFeedbackSelect;

/** The row shape {@link FEEDBACK_SELECT} returns. */
interface AnswerFeedbackRow {
  id: string;
  messageId: string;
  helpful: boolean;
  reason: string | null;
  createdAt: Date;
}

/**
 * Owns answer-feedback (👍/👎 + reason) persistence (M3.4, PRD §"Chat experience"). A user rates an
 * assistant answer helpful or not; `answer_feedback` is `user_scoped` under Postgres RLS (directive
 * §4.21), so every read/write runs inside {@link RlsService.run} and a peer's feedback is invisible.
 *
 * Feedback takes only a `messageId`: the owning conversation is derived server-side from the
 * message and its ownership re-checked (directive §26), because `messages` is `tenant_only` under
 * RLS (any user in the tenant can read any message) while `conversations` is `user_scoped` — so the
 * conversation lookup is the boundary that stops a user from rating an answer in a chat they don't
 * own. This is the same ownership shape as {@link SavedAnswerService}; only `assistant` messages can
 * be rated. Unlike a bookmark, re-submitting is an idempotent **upsert** keyed on `(user, message)`
 * — a user may flip 👍↔👎 or revise the reason, so there is no duplicate-conflict here.
 */
@Injectable()
export class AnswerFeedbackService {
  constructor(private readonly rls: RlsService) {}

  /** Submit or revise the acting user's feedback on an assistant answer they own. */
  async submit(
    user: AuthUser,
    input: AnswerFeedbackSubmitInput,
  ): Promise<AnswerFeedbackDto> {
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

      const existing = await tx.answerFeedback.findUnique({
        where: { userId_messageId: { userId: user.id, messageId: input.messageId } },
        select: { id: true },
      });

      const reason = input.reason ?? null;
      const row = (
        existing
          ? await tx.answerFeedback.update({
              where: { id: existing.id },
              data: { helpful: input.helpful, reason },
              select: FEEDBACK_SELECT,
            })
          : await tx.answerFeedback.create({
              data: {
                tenantId: user.tenantId,
                userId: user.id,
                messageId: input.messageId,
                helpful: input.helpful,
                reason,
              },
              select: FEEDBACK_SELECT,
            })
      ) as AnswerFeedbackRow;
      return toAnswerFeedbackDto(row);
    });
  }

  /** Retracts the acting user's feedback on an answer. Throws {@link NotFoundException} if none. */
  async remove(user: AuthUser, messageId: string): Promise<void> {
    await this.rls.run(user, async (tx) => {
      const existing = await tx.answerFeedback.findUnique({
        where: { userId_messageId: { userId: user.id, messageId } },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException("feedback not found");
      }
      await tx.answerFeedback.delete({ where: { id: existing.id } });
    });
  }
}

/** Flatten a {@link FEEDBACK_SELECT} row into the public {@link AnswerFeedbackDto}. */
function toAnswerFeedbackDto(row: AnswerFeedbackRow): AnswerFeedbackDto {
  return {
    id: row.id,
    messageId: row.messageId,
    helpful: row.helpful,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
