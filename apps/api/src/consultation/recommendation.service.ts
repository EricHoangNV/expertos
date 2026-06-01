import { Injectable } from "@nestjs/common";
import { evaluateRecommendation, type RecommendationRule } from "@expertos/ai";
import type {
  ConsultationRecommendationDto,
  ConsultationTypeDto,
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
}
