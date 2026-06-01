import { Injectable, NotFoundException } from "@nestjs/common";
import { evaluateRecommendation, type RecommendationRule } from "@expertos/ai";
import type {
  ConsultationRecommendationDto,
  ConsultationTypeDto,
  RecommendationRespondInput,
  RecommendationResponseResultDto,
  RecommendationTriggerValue,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";

/**
 * The signals of one finished chat turn the engine needs, gathered by {@link ChatService}. The
 * conversation's assistant-turn count is derived here (a DB read), not passed in, so the caller
 * doesn't have to know the windowing rules of the loaded history.
 */
export interface RecommendationInput {
  /** The conversation the turn belongs to (always set — `persistTurn` resolves a new one). */
  conversationId: string;
  /** The user's question (NFC-normalized at the API boundary). */
  question: string;
  /** The generated answer text. */
  answer: string;
  /** How many sources the answer cited. */
  citationCount: number;
  /** True when no grounding sources were retrieved (the insufficient-knowledge path, M3.4). */
  insufficientKnowledge: boolean;
}

/**
 * Plain-language reason shown in the in-chat recommendation prompt, per trigger (M7.1). Product
 * copy lives here so the wording is single-sourced; the engine only decides *which* trigger fired.
 */
const REASONS: Record<RecommendationTriggerValue, string> = {
  high_intent:
    "It sounds like you're ready to take the next step — book a consultation to work directly with the expert.",
  topic:
    "This is a high-stakes area where tailored advice matters. A consultation gets you a direct, accountable answer.",
  low_confidence:
    "I couldn't fully ground that answer in the expert's knowledge. A consultation can get you a definitive answer.",
  depth: "You've gone deep on this — a focused consultation can give you personalized, end-to-end guidance.",
};

const RULE_SELECT = {
  trigger: true,
  enabled: true,
  threshold: true,
  keywords: true,
  priority: true,
  consultationTypeKey: true,
} satisfies Prisma.RecommendationRuleSelect;

const CONSULTATION_TYPE_SELECT = {
  key: true,
  name: true,
  durationMinutes: true,
  tidycalLink: true,
} satisfies Prisma.ConsultationTypeSelect;

/**
 * The consultation-recommendation seam (M7.1, PRD §"Consultation funnel"). After a chat turn is
 * persisted, decides whether to surface an in-chat "book a consultation" prompt by feeding the
 * turn's signals + the admin-editable `recommendation_rules` config into the pure
 * {@link evaluateRecommendation} engine. When a rule fires it persists a
 * `consultation_recommendations` row (the funnel's first datapoint — M7.2 records the user's
 * Book / Maybe later / Ask another response against its id; M10.2 attributes revenue through it)
 * and returns the wire DTO; otherwise null.
 *
 * The recommendation must never break an answer that has already streamed: every failure is caught,
 * logged, and degraded to "no recommendation" so the `done` event is always emitted. `rules` and
 * `consultation_types` are RLS-exempt config; `consultation_recommendations` is `user_scoped`, so
 * the whole evaluation runs inside one {@link RlsService.run} transaction (directive §4.21).
 *
 * The consumer-facing half (M7.2) is {@link respond}: it records the user's Book / Maybe later / Ask
 * another choice against the persisted recommendation, and on `book` opens the TidyCal booking by
 * creating a `consultations` row (the funnel-attribution join — M10.2) and returning its link.
 */
@Injectable()
export class RecommendationService {
  constructor(
    private readonly rls: RlsService,
    private readonly logger: StructuredLogger,
  ) {}

  async recommend(
    user: AuthUser,
    input: RecommendationInput,
  ): Promise<ConsultationRecommendationDto | null> {
    try {
      return await this.rls.run(user, async (tx) => {
        const rules = await this.loadRules(tx);
        if (rules.length === 0) {
          return null;
        }

        // Count assistant turns in this conversation *including* the one just persisted (the caller
        // runs this after `persistTurn` commits), so `depth` measures true conversation length —
        // not the token-windowed history the prompt replayed.
        const assistantTurnCount = await tx.message.count({
          where: { conversationId: input.conversationId, role: "assistant" },
        });

        const outcome = evaluateRecommendation(
          {
            question: input.question,
            answer: input.answer,
            citationCount: input.citationCount,
            insufficientKnowledge: input.insufficientKnowledge,
            assistantTurnCount,
          },
          rules,
        );
        if (!outcome) {
          return null;
        }

        const consultationType = await this.resolveConsultationType(tx, outcome.consultationTypeKey);

        const rec = await tx.consultationRecommendation.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            conversationId: input.conversationId,
            trigger: outcome.trigger,
          },
          select: { id: true },
        });

        this.logger.info("consultation recommended", {
          conversationId: input.conversationId,
          trigger: outcome.trigger,
          matched: outcome.matchedKeyword ?? "",
        });

        return {
          id: rec.id,
          trigger: outcome.trigger,
          reason: REASONS[outcome.trigger],
          consultationType,
        };
      });
    } catch (error) {
      // A funnel hiccup must never turn a delivered answer into an error — degrade to no prompt.
      this.logger.error("consultation recommendation failed", {
        conversationId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Records the user's response to a recommendation (M7.2). `book` opens the TidyCal booking:
   * it resolves the consultation type from the recommendation's stored trigger (server-derived,
   * never client-trusted — directive §26), creates a `consultations` row linked back to the
   * recommendation (the funnel-attribution join M10.2 reads), and returns the booking link for the
   * client to open. `maybe_later`/`ask_another` only record the choice (still useful funnel signal).
   *
   * Ownership is enforced by RLS: `consultation_recommendations` is `user_scoped`, so a peer's row
   * is invisible and the `findUnique` returns null → 404 (directive §4.21). Booking is idempotent —
   * a second `book` reuses the already-created consultation rather than spawning a duplicate.
   * Unlike {@link recommend}, this runs on an explicit user action (not after a streamed answer),
   * so failures propagate as real HTTP errors instead of degrading silently.
   */
  async respond(
    user: AuthUser,
    recommendationId: string,
    input: RecommendationRespondInput,
  ): Promise<RecommendationResponseResultDto> {
    return this.rls.run(user, async (tx) => {
      // RLS scopes `consultation_recommendations` to the acting user — a peer's row reads as null.
      const rec = await tx.consultationRecommendation.findUnique({
        where: { id: recommendationId },
        select: { id: true, trigger: true, consultationId: true },
      });
      if (!rec) {
        throw new NotFoundException("recommendation not found");
      }

      await tx.consultationRecommendation.update({
        where: { id: recommendationId },
        data: { response: input.response },
      });

      if (input.response !== "book") {
        return { id: rec.id, response: input.response, booking: null };
      }

      // Idempotent: if the user already clicked Book, reuse the existing consultation + its link.
      if (rec.consultationId) {
        const existing = await tx.consultation.findUnique({
          where: { id: rec.consultationId },
          select: { id: true, type: { select: { tidycalLink: true } } },
        });
        if (existing) {
          return {
            id: rec.id,
            response: input.response,
            booking: { consultationId: existing.id, tidycalLink: existing.type?.tidycalLink ?? null },
          };
        }
      }

      const type = await this.resolveBookableType(tx, rec.trigger);
      const consultation = await tx.consultation.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          typeId: type?.id ?? null,
          status: "recommended",
          amountCents: type?.priceCents ?? null,
        },
        select: { id: true },
      });
      await tx.consultationRecommendation.update({
        where: { id: recommendationId },
        data: { consultationId: consultation.id },
      });

      this.logger.info("consultation booking opened", {
        recommendationId: rec.id,
        consultationId: consultation.id,
        trigger: rec.trigger,
      });

      return {
        id: rec.id,
        response: input.response,
        booking: { consultationId: consultation.id, tidycalLink: type?.tidycalLink ?? null },
      };
    });
  }

  /** Loads the enabled admin-configured rules (RLS-exempt config). */
  private async loadRules(tx: Prisma.TransactionClient): Promise<RecommendationRule[]> {
    const rows = await tx.recommendationRule.findMany({
      where: { enabled: true },
      select: RULE_SELECT,
    });
    return rows.map((r) => ({
      trigger: r.trigger,
      enabled: r.enabled,
      threshold: r.threshold,
      keywords: r.keywords,
      priority: r.priority,
      consultationTypeKey: r.consultationTypeKey,
    }));
  }

  /**
   * Resolves the consultation type to recommend: the rule's configured `key` if it maps to an active
   * type, else the active default (oldest active type). Null when no active type exists at all — the
   * client then shows a generic "book a consultation" CTA.
   */
  private async resolveConsultationType(
    tx: Prisma.TransactionClient,
    key: string | null,
  ): Promise<ConsultationTypeDto | null> {
    if (key) {
      const byKey = await tx.consultationType.findFirst({
        where: { key, active: true },
        select: CONSULTATION_TYPE_SELECT,
      });
      if (byKey) {
        return byKey;
      }
    }
    return tx.consultationType.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: CONSULTATION_TYPE_SELECT,
    });
  }

  /**
   * Resolves the bookable consultation type for a `book` response (M7.2). The recommendation row
   * stores only its trigger, so we re-read the trigger's rule to find the configured
   * `consultationTypeKey`, then resolve that active type (falling back to the active default, like
   * {@link resolveConsultationType}). Selects the booking-time fields (`id`/`priceCents` to stamp
   * the `consultations` row, `tidycalLink` to return). Null when no active type exists at all.
   */
  private async resolveBookableType(
    tx: Prisma.TransactionClient,
    trigger: RecommendationTriggerValue,
  ): Promise<{ id: string; priceCents: number | null; tidycalLink: string | null } | null> {
    const select = { id: true, priceCents: true, tidycalLink: true } satisfies Prisma.ConsultationTypeSelect;
    const rule = await tx.recommendationRule.findUnique({
      where: { trigger },
      select: { consultationTypeKey: true },
    });
    const key = rule?.consultationTypeKey ?? null;
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
}
