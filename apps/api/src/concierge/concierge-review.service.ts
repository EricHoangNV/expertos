import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import type {
  ConciergeQueueListQueryInput,
  ReviewEscalateInput,
  ReviewEscalationDto,
  ReviewQueueDetailDto,
  ReviewQueueItemDto,
  ReviewResponseCreateInput,
  ReviewResponseDto,
  ReviewVerdictValue,
} from "@expertos/shared";
import { PRISMA } from "../database/database.module";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { ConciergeFlywheelService } from "./concierge-flywheel.service";
import { ConciergeDeliveryService } from "./concierge-delivery.service";

/** Max characters of the AI answer surfaced as a queue-item preview. */
const ANSWER_PREVIEW_CHARS = 280;

/** A persisted review-request row the queue/detail reads return. */
interface RequestRow {
  id: string;
  userId: string;
  messageId: string;
  triggerMode: "user_prompted" | "auto_silent";
  visibility: "visible" | "silent";
  confidenceScore: number | null;
  status: ReviewQueueItemDto["status"];
  slaDueAt: Date | null;
  claimedAt: Date | null;
  answeredAt: Date | null;
  createdAt: Date;
  message: { content: string; conversationId: string; createdAt: Date };
  responses: ResponseRow[];
}

/** A persisted review-response row. */
interface ResponseRow {
  id: string;
  reviewerId: string;
  verdict: ReviewVerdictValue;
  originalAnswer: string;
  revisedAnswer: string | null;
  edited: boolean;
  notes: string | null;
  deliveredToUser: boolean;
  createdAt: Date;
}

const REQUEST_SELECT = {
  id: true,
  userId: true,
  messageId: true,
  triggerMode: true,
  visibility: true,
  confidenceScore: true,
  status: true,
  slaDueAt: true,
  claimedAt: true,
  answeredAt: true,
  createdAt: true,
  message: { select: { content: true, conversationId: true, createdAt: true } },
  responses: {
    select: {
      id: true,
      reviewerId: true,
      verdict: true,
      originalAnswer: true,
      revisedAnswer: true,
      edited: true,
      notes: true,
      deliveredToUser: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.HumanReviewRequestSelect;

/** Request statuses a reviewer may still act on (record a verdict for). */
const RESPONDABLE: ReadonlySet<RequestRow["status"]> = new Set(["requested", "in_review"]);

/**
 * The concierge **reviewer** seam (M9.2, PRD §"Expert portal" → "Concierge review queue"). The single
 * choke point behind the `@Roles("expert")` `/concierge-reviews` routes: the queue of AI answers
 * flagged for human review, scoped to the reviewer's voice, plus the reviewer's verdict
 * (Good / Bad / Great) + edit.
 *
 * Isolation model (the M8.5 {@link ExpertPortalService} pattern). The queued requests are over end
 * users' data: `human_review_requests` is `user_scoped`, so a non-admin expert can't read them under
 * their own RLS context. Reads/writes therefore run in an **elevated** ({@link applyRlsContext}
 * `is_admin`) context and re-establish isolation **explicitly** in every query — a `tenant_id`
 * predicate AND a `message.conversation.expertId = <this expert>` predicate (the voice scope). The
 * expert is resolved first (a non-admin → their own linked `Expert`; an admin → the `expertId` they
 * pass), and when no expert resolves the queue short-circuits to empty / a 404, so every query always
 * carries a concrete `expert_id` and can never widen to the whole tenant.
 *
 * Auditability: a {@link ReviewResponse} row *is* the durable record of the reviewer's action
 * (reviewer id + verdict + timestamp), so — like the M8.5 expert portal — this service does not write
 * a separate `admin_audit_logs` entry. Escalate-to-consultation + the global flywheel (Great/edited
 * → voice examples / knowledge drafts, Bad → chunk flagging) are M9.4; M9.2 records the verdict + edit
 * and moves the request to `answered`.
 */
@Injectable()
export class ConciergeReviewService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logger: StructuredLogger,
    private readonly flywheel: ConciergeFlywheelService,
    private readonly delivery: ConciergeDeliveryService,
  ) {}

  /** A page of the reviewer's queue, most-actionable first (open items by SLA, then newest). */
  async list(
    user: AuthUser,
    requestedExpertId: string | null,
    query: ConciergeQueueListQueryInput,
  ): Promise<ReviewQueueItemDto[]> {
    return this.runReviewer(user, async (tx) => {
      const expert = await this.resolveExpert(tx, user, requestedExpertId);
      if (!expert) {
        return [];
      }
      const rows = (await tx.humanReviewRequest.findMany({
        where: {
          tenantId: user.tenantId,
          message: { conversation: { expertId: expert.id } },
          ...(query.status ? { status: query.status } : {}),
        },
        select: REQUEST_SELECT,
        orderBy: [{ status: "asc" }, { slaDueAt: "asc" }, { createdAt: "asc" }],
        take: query.limit,
        skip: query.offset,
      })) as RequestRow[];
      return rows.map(toItemDto);
    });
  }

  /** Full detail for one queued review (answer + prompting question + recorded responses). */
  async get(
    user: AuthUser,
    requestedExpertId: string | null,
    id: string,
  ): Promise<ReviewQueueDetailDto> {
    return this.runReviewer(user, async (tx) => {
      const row = await this.loadInVoice(tx, user, requestedExpertId, id);
      const question = await tx.message.findFirst({
        where: {
          conversationId: row.message.conversationId,
          role: "user",
          createdAt: { lte: row.message.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      return toDetailDto(row, question?.content ?? null);
    });
  }

  /**
   * Records a reviewer's verdict + optional edit on a queued answer (M9.2). Creates a
   * `review_responses` row (stamping the answer as it stood for provenance + deriving `edited`) and
   * moves the request to `answered`. The request must be in the reviewer's voice (else 404) and still
   * respondable — a 409 guards against double-answering a closed request.
   */
  async respond(
    user: AuthUser,
    requestedExpertId: string | null,
    id: string,
    input: ReviewResponseCreateInput,
  ): Promise<ReviewResponseDto> {
    const { dto, flywheel, delivery } = await this.runReviewer(user, async (tx) => {
      const row = await this.loadInVoice(tx, user, requestedExpertId, id);
      if (!RESPONDABLE.has(row.status)) {
        throw new ConflictException(`review is already ${row.status}`);
      }

      const original = row.message.content;
      const revised = input.revisedAnswer;
      const edited = revised !== null && revised !== original;

      const response = (await tx.reviewResponse.create({
        data: {
          tenantId: user.tenantId,
          reviewRequestId: row.id,
          reviewerId: user.id,
          verdict: input.verdict,
          originalAnswer: original,
          revisedAnswer: revised,
          edited,
          notes: input.notes,
        },
        select: {
          id: true,
          reviewerId: true,
          verdict: true,
          originalAnswer: true,
          revisedAnswer: true,
          edited: true,
          notes: true,
          deliveredToUser: true,
          createdAt: true,
        },
      })) as ResponseRow;

      await tx.humanReviewRequest.update({
        where: { id: row.id },
        data: { status: "answered", answeredAt: new Date(), assigneeId: user.id },
      });

      this.logger.info("concierge review answered", {
        reviewRequestId: row.id,
        verdict: input.verdict,
        edited,
      });

      return {
        dto: toResponseDto(response),
        flywheel: {
          reviewRequestId: row.id,
          tenantId: user.tenantId,
          verdict: input.verdict,
          improvedAnswer: revised ?? original,
          edited,
        },
        delivery: {
          reviewRequestId: row.id,
          responseId: response.id,
          tenantId: user.tenantId,
          revisedAnswer: revised,
          edited,
        },
      };
    });

    // Feed the reviewer's verdict into the global flywheel (M9.4). Best-effort: the service swallows
    // its own errors so the recorded verdict (already committed above) is never rolled back.
    await this.flywheel.applyReviewOutcome(flywheel);

    // Async-deliver the refined answer back to the user (M9.3): push an edited answer into the
    // conversation + email the user. Also best-effort (swallows its own errors), and a no-op for a
    // verdict-only response that left the answer unchanged (it stays silent).
    await this.delivery.deliver(delivery);

    return dto;
  }

  /**
   * Escalates a concierge case into a paid consultation (M9.4). A reviewer who judges that the answer
   * needs a deeper, live engagement opens a `recommended` consultation for the **asking user** (the
   * funnel-attribution row the booking webhook later confirms) and moves the request to `escalated`.
   * The request must be in the reviewer's voice (else 404) and still open (else 409).
   */
  async escalate(
    user: AuthUser,
    requestedExpertId: string | null,
    id: string,
    input: ReviewEscalateInput,
  ): Promise<ReviewEscalationDto> {
    return this.runReviewer(user, async (tx) => {
      const row = await this.loadInVoice(tx, user, requestedExpertId, id);
      if (!RESPONDABLE.has(row.status)) {
        throw new ConflictException(`review is already ${row.status}`);
      }

      const type = await this.resolveConsultationType(tx, input.consultationTypeKey);
      const consultation = await tx.consultation.create({
        data: {
          tenantId: user.tenantId,
          userId: row.userId,
          typeId: type?.id ?? null,
          status: "recommended",
          amountCents: type?.priceCents ?? null,
        },
        select: { id: true },
      });

      await tx.humanReviewRequest.update({
        where: { id: row.id },
        data: { status: "escalated", assigneeId: user.id },
      });

      this.logger.info("concierge review escalated", {
        reviewRequestId: row.id,
        consultationId: consultation.id,
        consultationTypeKey: type?.key ?? "",
      });

      return {
        reviewRequestId: row.id,
        status: "escalated",
        consultationId: consultation.id,
        consultationTypeKey: type?.key ?? null,
        tidycalLink: type?.tidycalLink ?? null,
      };
    });
  }

  /**
   * Resolves the consultation type to open: the requested `key` if it maps to an active type, else
   * the active default (oldest active type). Null when no active type exists — the consultation is
   * opened untyped and the booking flow surfaces a generic CTA (mirrors `RecommendationService`).
   */
  private async resolveConsultationType(
    tx: Prisma.TransactionClient,
    key: string | null,
  ): Promise<{ id: string; key: string; priceCents: number | null; tidycalLink: string | null } | null> {
    const select = {
      id: true,
      key: true,
      priceCents: true,
      tidycalLink: true,
    } satisfies Prisma.ConsultationTypeSelect;
    if (key) {
      const byKey = await tx.consultationType.findFirst({ where: { key, active: true }, select });
      if (byKey) {
        return byKey;
      }
    }
    return tx.consultationType.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select,
    });
  }

  /** Loads a review request bounded to the reviewer's voice (404 when not visible to this expert). */
  private async loadInVoice(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    requestedExpertId: string | null,
    id: string,
  ): Promise<RequestRow> {
    const expert = await this.resolveExpert(tx, user, requestedExpertId);
    if (!expert) {
      throw new NotFoundException("review not found");
    }
    const row = (await tx.humanReviewRequest.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        message: { conversation: { expertId: expert.id } },
      },
      select: REQUEST_SELECT,
    })) as RequestRow | null;
    if (!row) {
      throw new NotFoundException("review not found");
    }
    return row;
  }

  /**
   * Resolves the expert this view is scoped to (the {@link ExpertPortalService} pattern): a non-admin
   * to their own linked `Expert` row, an admin to the `requestedExpertId` they pass (none → no scope).
   */
  private resolveExpert(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    requestedExpertId: string | null,
  ): Promise<{ id: string } | null> {
    if (user.role === "admin") {
      if (!requestedExpertId) {
        return Promise.resolve(null);
      }
      return tx.expert.findFirst({
        where: { id: requestedExpertId, tenantId: user.tenantId },
        select: { id: true },
      });
    }
    return tx.expert.findFirst({
      where: { userId: user.id, tenantId: user.tenantId },
      select: { id: true },
    });
  }

  /**
   * Runs reviewer reads/writes in an elevated RLS context (`is_admin`) so the expert can reach the
   * customers' `user_scoped` review requests; isolation is re-established by the explicit
   * `tenant_id` + `expert_id` predicates in every query. Pinned to the caller's tenant.
   */
  private runReviewer<T>(
    user: AuthUser,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: user.tenantId, isAdmin: true });
      return work(tx);
    });
  }
}

function toItemDto(row: RequestRow): ReviewQueueItemDto {
  const latest = row.responses[0];
  return {
    id: row.id,
    messageId: row.messageId,
    conversationId: row.message.conversationId,
    triggerMode: row.triggerMode,
    visibility: row.visibility,
    confidenceScore: row.confidenceScore,
    status: row.status,
    slaDueAt: row.slaDueAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    answerPreview: row.message.content.slice(0, ANSWER_PREVIEW_CHARS),
    latestVerdict: latest?.verdict ?? null,
    responseCount: row.responses.length,
  };
}

function toDetailDto(row: RequestRow, question: string | null): ReviewQueueDetailDto {
  return {
    id: row.id,
    messageId: row.messageId,
    conversationId: row.message.conversationId,
    triggerMode: row.triggerMode,
    visibility: row.visibility,
    confidenceScore: row.confidenceScore,
    status: row.status,
    slaDueAt: row.slaDueAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    answer: row.message.content,
    question,
    responses: row.responses.map(toResponseDto),
  };
}

function toResponseDto(row: ResponseRow): ReviewResponseDto {
  return {
    id: row.id,
    reviewerId: row.reviewerId,
    verdict: row.verdict,
    originalAnswer: row.originalAnswer,
    revisedAnswer: row.revisedAnswer,
    edited: row.edited,
    notes: row.notes,
    deliveredToUser: row.deliveredToUser,
    createdAt: row.createdAt.toISOString(),
  };
}
