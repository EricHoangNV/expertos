import { Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import type {
  ConsultationStatusValue,
  ExpertAnswerListQueryInput,
  ExpertAnswerReviewDto,
  ExpertConversionItemDto,
  ExpertConversionsDto,
  RecommendationFunnelResponse,
  RecommendationTriggerValue,
} from "@expertos/shared";
import { PRISMA } from "../database/database.module";
import type { AuthUser } from "../auth/auth.types";

/** Stable key sets so every grouped count starts at zero (a `Record<Union, number>` needs all keys). */
const TRIGGERS: readonly RecommendationTriggerValue[] = [
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
];
const RESPONSES: readonly RecommendationFunnelResponse[] = [
  "pending",
  "book",
  "maybe_later",
  "ask_another",
];
const CONSULTATION_STATUSES: readonly ConsultationStatusValue[] = [
  "recommended",
  "booked",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
];

/** Statuses whose `amount_cents` count as realised/attributable booked revenue. */
const REVENUE_STATUSES: ReadonlySet<ConsultationStatusValue> = new Set([
  "booked",
  "confirmed",
  "completed",
]);

/** How many recent recommendations the conversions feed carries. */
const RECENT_LIMIT = 25;

/** Raw row shape the answer-review SQL returns (snake_case columns from Postgres). */
interface AnswerRow {
  message_id: string;
  conversation_id: string;
  question: string | null;
  answer: string;
  model: string | null;
  confidence: number | null;
  insufficient_knowledge: boolean;
  helpful: boolean | null;
  feedback_reason: string | null;
  created_at: Date;
}

/**
 * The expert-portal read seam (M8.5, PRD §"Expert portal"). The single choke point behind the
 * `@Roles("expert")` `GET /expert/conversions` and `GET /expert/answers` routes. It gives an expert a
 * **voice-scoped** window onto the funnel their conversations produced: consultation conversions
 * (recommendations → bookings → revenue) and the AI answers rendered in their voice (for review).
 *
 * Isolation model — important. The funnel rows (`conversations`, `consultation_recommendations`,
 * `consultations`, `answer_feedback`) belong to the *end users*, not the expert, and most are
 * `user_scoped` under RLS. So a non-admin expert can't see them under their own RLS context. This
 * service therefore runs reads in an **elevated context** ({@link runReviewer}: the `is_admin` GUC,
 * mirroring {@link BillingService}/{@link BookingService}'s `runAsSystem`) and re-establishes
 * isolation **explicitly** in every query: a `tenant_id` predicate (the expert is *not* a platform
 * admin) AND a `conversations.expert_id = <this expert>` predicate (the voice scope). The expert is
 * resolved first — a non-admin to their own linked `Expert` row, an admin to the `expertId` they
 * pass — and when no expert resolves the reads short-circuit to an empty result (every data query
 * thus always carries a concrete `expert_id`, so it can never widen to the whole tenant).
 *
 * Read-only. Voice + knowledge *approval* (the other M8.5 deliverables) already run through the
 * expert-scoped `VoiceProfileService` / tenant-scoped `KnowledgeService` (M2.3 / M8.1); the portal UI
 * just consumes those existing `@Roles("expert")` routes.
 */
@Injectable()
export class ExpertPortalService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** The consultation-conversion summary for one expert's voice. */
  async conversions(
    user: AuthUser,
    requestedExpertId: string | null,
  ): Promise<ExpertConversionsDto> {
    return this.runReviewer(user, async (tx) => {
      const expert = await this.resolveExpert(tx, user, requestedExpertId);
      const result = emptyConversions(expert);
      if (!expert) {
        return result;
      }

      // Voice scope: recommendations whose conversation was held in this expert's voice.
      const recWhere: Prisma.ConsultationRecommendationWhereInput = {
        tenantId: user.tenantId,
        conversation: { expertId: expert.id },
      };

      const grouped = await tx.consultationRecommendation.groupBy({
        by: ["trigger", "response"],
        where: recWhere,
        _count: { _all: true },
      });
      for (const row of grouped) {
        const n = row._count._all;
        result.recommendationCount += n;
        result.byTrigger[row.trigger] += n;
        result.byResponse[row.response] += n;
      }

      const byStatus = await tx.consultation.groupBy({
        by: ["status"],
        where: {
          tenantId: user.tenantId,
          recommendations: { some: { conversation: { expertId: expert.id } } },
        },
        _count: { _all: true },
        _sum: { amountCents: true },
      });
      for (const row of byStatus) {
        result.byConsultationStatus[row.status] += row._count._all;
        if (REVENUE_STATUSES.has(row.status)) {
          result.revenueCents += row._sum.amountCents ?? 0;
        }
      }

      const recent = await tx.consultationRecommendation.findMany({
        where: recWhere,
        select: {
          id: true,
          trigger: true,
          response: true,
          createdAt: true,
          consultation: { select: { status: true, amountCents: true } },
        },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
      });
      result.recent = recent.map(toConversionItem);

      return result;
    });
  }

  /** A page of AI answers rendered in this expert's voice, newest first, for review. */
  async answers(
    user: AuthUser,
    requestedExpertId: string | null,
    query: ExpertAnswerListQueryInput,
  ): Promise<ExpertAnswerReviewDto[]> {
    return this.runReviewer(user, async (tx) => {
      const expert = await this.resolveExpert(tx, user, requestedExpertId);
      if (!expert) {
        return [];
      }
      const rows = await tx.$queryRawUnsafe<AnswerRow[]>(
        ANSWERS_SQL,
        user.tenantId,
        expert.id,
        query.limit,
        query.offset,
      );
      return rows.map(toAnswerDto);
    });
  }

  /**
   * Resolves the expert this view is scoped to. A non-admin is scoped to their own linked `Expert`
   * row (self-lookup by natural key — not the RLS isolation predicate, which the elevated context
   * has bypassed; the same shape `EntitlementService.resolvePlan` uses). An admin may target any
   * expert in their tenant via `requestedExpertId`; with none supplied there is no expert to scope
   * to (the caller then gets an empty result, never a tenant-wide read).
   */
  private resolveExpert(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    requestedExpertId: string | null,
  ): Promise<{ id: string; displayName: string } | null> {
    if (user.role === "admin") {
      if (!requestedExpertId) {
        return Promise.resolve(null);
      }
      return tx.expert.findFirst({
        where: { id: requestedExpertId, tenantId: user.tenantId },
        select: { id: true, displayName: true },
      });
    }
    return tx.expert.findFirst({
      where: { userId: user.id, tenantId: user.tenantId },
      select: { id: true, displayName: true },
    });
  }

  /**
   * Runs reviewer reads in an elevated RLS context (the `is_admin` GUC) so the expert can read the
   * *customers'* user-scoped funnel rows for their voice. Isolation is then re-established by the
   * explicit `tenant_id` + `expert_id` predicates in every query (see the class doc). Mirrors
   * {@link BookingService}'s `runAsSystem`, but stays pinned to the caller's tenant.
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

/** A zeroed conversions DTO with every grouped key present (so callers can `+=` safely). */
function emptyConversions(
  expert: { id: string; displayName: string } | null,
): ExpertConversionsDto {
  const byTrigger = {} as Record<RecommendationTriggerValue, number>;
  for (const t of TRIGGERS) {
    byTrigger[t] = 0;
  }
  const byResponse = {} as Record<RecommendationFunnelResponse, number>;
  for (const r of RESPONSES) {
    byResponse[r] = 0;
  }
  const byConsultationStatus = {} as Record<ConsultationStatusValue, number>;
  for (const s of CONSULTATION_STATUSES) {
    byConsultationStatus[s] = 0;
  }
  return {
    expert,
    recommendationCount: 0,
    byTrigger,
    byResponse,
    byConsultationStatus,
    revenueCents: 0,
    recent: [],
  };
}

/** Flatten a recent recommendation (with its optional consultation) into the feed DTO. */
function toConversionItem(row: {
  id: string;
  trigger: RecommendationTriggerValue;
  response: RecommendationFunnelResponse;
  createdAt: Date;
  consultation: { status: ConsultationStatusValue; amountCents: number | null } | null;
}): ExpertConversionItemDto {
  return {
    recommendationId: row.id,
    trigger: row.trigger,
    response: row.response,
    consultationStatus: row.consultation?.status ?? null,
    amountCents: row.consultation?.amountCents ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Flatten a raw {@link AnswerRow} into the public {@link ExpertAnswerReviewDto}. */
function toAnswerDto(row: AnswerRow): ExpertAnswerReviewDto {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    question: row.question,
    answer: row.answer,
    model: row.model,
    confidence: row.confidence,
    insufficientKnowledge: row.insufficient_knowledge,
    helpful: row.helpful,
    feedbackReason: row.feedback_reason,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * The AI-answer review feed. `$1` = tenantId, `$2` = expertId, `$3` = limit, `$4` = offset. Each
 * assistant message in a conversation held in this expert's voice, paired (LATERAL) with the
 * most-recent user message at/before it (the prompting question) and the latest feedback verdict on
 * it. The insufficient-knowledge flag is derived from empty `source_version_ids` (the same proxy the
 * failed-query inspector and chat pipeline use). The elevated RLS context grants the cross-user read;
 * the explicit `c.tenant_id` + `c.expert_id` predicates are the isolation boundary.
 */
const ANSWERS_SQL = `
  SELECT
    m.id                                    AS message_id,
    m.conversation_id                       AS conversation_id,
    m.content                               AS answer,
    m.model                                 AS model,
    m.confidence                            AS confidence,
    (cardinality(m.source_version_ids) = 0) AS insufficient_knowledge,
    m.created_at                            AS created_at,
    q.content                               AS question,
    fb.helpful                              AS helpful,
    fb.reason                               AS feedback_reason
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  LEFT JOIN LATERAL (
    SELECT um.content
    FROM messages um
    WHERE um.conversation_id = m.conversation_id
      AND um.role = 'user'::message_role
      AND um.created_at <= m.created_at
    ORDER BY um.created_at DESC
    LIMIT 1
  ) q ON true
  LEFT JOIN LATERAL (
    SELECT af.helpful, af.reason
    FROM answer_feedback af
    WHERE af.message_id = m.id
    ORDER BY af.created_at DESC
    LIMIT 1
  ) fb ON true
  WHERE m.role = 'assistant'::message_role
    AND c.tenant_id = $1::uuid
    AND c.expert_id = $2::uuid
  ORDER BY m.created_at DESC
  LIMIT $3 OFFSET $4`;
