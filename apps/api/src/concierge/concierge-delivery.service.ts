import { Injectable, Inject } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import { StructuredLogger } from "../observability/logger.service";
import { EmailService } from "../email/email.service";

/** Base URL of the consumer web app — used to deep-link the user back to their refined answer. */
const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:3000";

/** What {@link ConciergeReviewService} hands the delivery service after a verdict commits. */
export interface DeliveryInput {
  /** The answered `human_review_requests` row. */
  reviewRequestId: string;
  /** The `review_responses` row just written (marked delivered when the push-back succeeds). */
  responseId: string;
  /** The tenant the review belongs to (the elevated context is re-bounded to it). */
  tenantId: string;
  /** The reviewer's improved answer text, or null when they only rated it. */
  revisedAnswer: string | null;
  /** True when the reviewer actually changed the answer (vs a verdict-only response). */
  edited: boolean;
}

/** What the elevated transaction resolved that the (out-of-tx) email send needs. */
interface DeliveryPlan {
  email: string;
  displayName: string | null;
  conversationId: string;
}

/**
 * Concierge **async delivery** (M9.3, PRD §"Concierge Mode" → async delivery). Invoked by
 * {@link ConciergeReviewService} right after a reviewer records a verdict (alongside the M9.4
 * flywheel), it lands the reviewer's *edited* answer back where the user can see it:
 *
 *   - **Visible update:** the refined answer is appended to the conversation as a new assistant
 *     message marked `refined_from_message_id` (the original it refines — the OD#5 visual-indicator
 *     signal), and the `review_responses` row is stamped `delivered_to_user = true`.
 *   - **Transactional email:** the asking user is notified ("your answer was reviewed and refined")
 *     with a deep link back to the conversation (Phase-1 email; push is Phase 2).
 *
 * Delivery fires only when the answer was **edited** — a verdict-only response (or a "great" with no
 * change) leaves nothing new to show, so it stays *silent* (the M9.4 context injection already feeds
 * the validated answer into future turns). This is the "visible update vs silent" choice.
 *
 * Isolation mirrors {@link ConciergeFlywheelService}: the review request is `user_scoped` and the
 * writes span `tenant_only` tables, so the DB work runs in an **elevated** ({@link applyRlsContext}
 * `is_admin`) context re-bounded to the caller's tenant; the email send happens **outside** the
 * transaction (no network in a DB tx). It is **non-fatal by design** — any failure is caught and
 * logged, never propagated, so a delivery hiccup can never roll back the reviewer's recorded verdict.
 */
@Injectable()
export class ConciergeDeliveryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly email: EmailService,
    private readonly logger: StructuredLogger,
  ) {}

  /** Delivers an edited concierge answer back to the user. Best-effort — swallows all errors. */
  async deliver(input: DeliveryInput): Promise<void> {
    // A verdict-only (unedited) response has no new answer to surface — keep it silent.
    if (!input.edited || input.revisedAnswer === null) {
      return;
    }
    const revisedAnswer = input.revisedAnswer;
    try {
      const plan = await this.runSystem(input.tenantId, (tx) =>
        this.pushRefinedUpdate(tx, input, revisedAnswer),
      );
      if (plan) {
        await this.notify(plan, input.reviewRequestId);
      }
    } catch (error) {
      this.logger.error("concierge delivery failed", {
        reviewRequestId: input.reviewRequestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The transactional half: append the refined answer as a new assistant message (carrying
   * `refinedFromMessageId` → the original), bump the conversation's activity timestamp, and stamp the
   * response delivered. Returns the plan the email step needs (or null when the request vanished).
   */
  private async pushRefinedUpdate(
    tx: Prisma.TransactionClient,
    input: DeliveryInput,
    revisedAnswer: string,
  ): Promise<DeliveryPlan | null> {
    const request = await tx.humanReviewRequest.findUnique({
      where: { id: input.reviewRequestId },
      select: {
        messageId: true,
        user: { select: { email: true, displayName: true } },
        message: { select: { conversationId: true } },
      },
    });
    if (!request) {
      return null;
    }
    const { messageId, user, message } = request;

    await tx.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: message.conversationId,
        role: "assistant",
        content: revisedAnswer,
        refinedFromMessageId: messageId,
      },
    });
    // Surface the refined update at the top of the user's history list.
    await tx.conversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() },
    });
    await tx.reviewResponse.update({
      where: { id: input.responseId },
      data: { deliveredToUser: true },
    });

    this.logger.info("concierge refined answer delivered", {
      reviewRequestId: input.reviewRequestId,
      conversationId: message.conversationId,
    });

    return {
      email: user.email,
      displayName: user.displayName,
      conversationId: message.conversationId,
    };
  }

  /** Sends the transactional notification (outside the tx). Best-effort — a failure is logged only. */
  private async notify(plan: DeliveryPlan, reviewRequestId: string): Promise<void> {
    const greeting = plan.displayName ? `Hi ${plan.displayName},` : "Hi,";
    const link = `${WEB_APP_URL}/history?c=${plan.conversationId}`;
    try {
      await this.email.send({
        to: plan.email,
        subject: "Your answer was reviewed and refined",
        text:
          `${greeting}\n\n` +
          "One of our experts reviewed your recent question and posted a refined answer in your " +
          `conversation. You can read it here:\n\n${link}\n\n` +
          "This response includes AI-reviewed/edited content.",
      });
    } catch (error) {
      this.logger.error("concierge delivery email failed", {
        reviewRequestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Runs delivery writes in an elevated (`is_admin`) context re-bounded to the tenant, so they can
   * reach the customer's `user_scoped` review request and pass the WITH-CHECK on the tenant-scoped
   * message/conversation rows. Mirrors {@link ConciergeFlywheelService}'s `runSystem`.
   */
  private runSystem<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId, isAdmin: true });
      return work(tx);
    });
  }
}
