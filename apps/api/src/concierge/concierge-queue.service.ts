import { Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";

/** The signals one finished chat turn carries that decide whether to queue a human review. */
interface ConciergeEnqueueInput {
  /** The assistant message just persisted (the answer under potential review). */
  messageId: string;
  /** The conversation the turn belongs to. */
  conversationId: string;
  /** True when no grounding sources were retrieved (the deterministic low-confidence proxy, M3.4). */
  insufficientKnowledge: boolean;
  /** The answer's confidence (0–1) when a real score exists; null today (the echo provider has none). */
  confidence: number | null;
}

/** The concierge config fields the trigger reads (RLS-exempt `review_configs` singleton). */
const CONFIG_SELECT = {
  enabled: true,
  triggerMode: true,
  confidenceThreshold: true,
  slaHours: true,
  volumeCapPerDay: true,
} satisfies Prisma.ReviewConfigSelect;

/**
 * The concierge **enqueue** seam (M9.2, PRD §"Concierge Mode" → Mode B shadow review). Consumed by
 * {@link ChatService} after a turn is persisted: when the admin config has **Mode B** (`auto_silent`)
 * enabled and the answer trips the low-confidence trigger, it quietly queues a `HumanReviewRequest`
 * for a human reviewer — the user still sees a normal AI answer (a silent shadow review). The
 * reviewer side (queue + verdict + edit) is {@link ConciergeReviewService}; async delivery of the
 * reviewed answer is M9.3.
 *
 * Why **Mode B only** here: Mode A (`user_prompted`) requires the user to opt in to a review, so its
 * enqueue is driven by a user action (the M9.3 user-facing prompt), not this post-answer hook. This
 * hook never fires for Mode A.
 *
 * Trigger condition: the deterministic `insufficientKnowledge` proxy (the same empty-sources signal
 * M3.4/M7.1 use), OR a real `confidence` at/below the configured threshold once a model emits one.
 *
 * Isolation: the daily volume cap is **tenant-wide** ("so the expert team isn't swamped"), but
 * `human_review_requests` is `user_scoped`, so a count under the asking user's own RLS context would
 * only see their own rows. The enqueue therefore runs in an **elevated** ({@link applyRlsContext}
 * `is_admin`) context re-bounded to the caller's tenant — the same system-context pattern as
 * `BillingService.runAsSystem` / {@link ExpertPortalService} — so the count is tenant-wide and the
 * insert (for the asking user) passes the WITH-CHECK. It is **non-fatal by design**: any failure is
 * caught and logged so a hiccup can never break an answer that has already streamed.
 */
@Injectable()
export class ConciergeQueueService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logger: StructuredLogger,
  ) {}

  /** Queues a silent human review for this turn iff Mode B is enabled and the trigger fires. */
  async enqueueIfTriggered(user: AuthUser, input: ConciergeEnqueueInput): Promise<void> {
    try {
      await this.runSystem(user.tenantId, async (tx) => {
        const config = await tx.reviewConfig.findFirst({ select: CONFIG_SELECT });
        // Only Mode B (auto-silent shadow review) auto-enqueues; Off and Mode A do not.
        if (!config || !config.enabled || config.triggerMode !== "auto_silent") {
          return;
        }
        if (!this.triggers(input, config.confidenceThreshold)) {
          return;
        }

        // Idempotency: never queue the same answer twice (re-delivery / retry safety).
        const existing = await tx.humanReviewRequest.findFirst({
          where: { tenantId: user.tenantId, messageId: input.messageId },
          select: { id: true },
        });
        if (existing) {
          return;
        }

        // Tenant-wide daily cap so the reviewer team isn't swamped (degrade-don't-block: over the cap
        // the answer still ships, it just isn't queued for review).
        const since = startOfUtcDay(new Date());
        const todayCount = await tx.humanReviewRequest.count({
          where: { tenantId: user.tenantId, createdAt: { gte: since } },
        });
        if (todayCount >= config.volumeCapPerDay) {
          this.logger.info("concierge enqueue skipped (volume cap)", {
            conversationId: input.conversationId,
            cap: config.volumeCapPerDay,
          });
          return;
        }

        const slaDueAt = new Date(Date.now() + config.slaHours * 60 * 60 * 1000);
        const created = await tx.humanReviewRequest.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            messageId: input.messageId,
            triggerMode: "auto_silent",
            visibility: "silent",
            confidenceScore: input.confidence,
            status: "requested",
            slaDueAt,
          },
          select: { id: true },
        });

        this.logger.info("concierge review queued", {
          reviewRequestId: created.id,
          conversationId: input.conversationId,
          triggerMode: "auto_silent",
        });
      });
    } catch (error) {
      // A queueing hiccup must never turn a delivered answer into an error.
      this.logger.error("concierge enqueue failed", {
        conversationId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Whether the answer trips the configured low-confidence trigger. */
  private triggers(input: ConciergeEnqueueInput, threshold: number): boolean {
    if (input.insufficientKnowledge) {
      return true;
    }
    return input.confidence !== null && input.confidence <= threshold;
  }

  /**
   * Runs the enqueue in an elevated (`is_admin`) context re-bounded to the caller's tenant, so the
   * tenant-wide volume-cap count is correct and the insert passes the WITH-CHECK. Mirrors
   * {@link ExpertPortalService}'s `runReviewer` / `BillingService.runAsSystem`.
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

/** Start of the current UTC day (the daily cap window). */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
