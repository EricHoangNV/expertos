import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  RecommendationConsultationTypeDto,
  RecommendationRuleDto,
  RecommendationRuleUpdateInput,
  RecommendationRulesDto,
  RecommendationTriggerValue,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** The keyword triggers — they match on `keywords`; the rest (`depth`/`low_confidence`) on `threshold`. */
const KEYWORD_TRIGGERS: ReadonlySet<RecommendationTriggerValue> = new Set([
  "topic",
  "high_intent",
]);

const RULE_SELECT = {
  trigger: true,
  enabled: true,
  threshold: true,
  keywords: true,
  priority: true,
  consultationTypeKey: true,
} satisfies Prisma.RecommendationRuleSelect;

/**
 * The admin recommendation-rules editor (M8.3, PRD §"Admin" → "Inspect failed / low-confidence
 * queries" sibling; the funnel-tuning surface). The single **write** choke point over the
 * `recommendation_rules` config table — the consultation-funnel triggers (topic, depth,
 * low-confidence, high-intent) become admin-tunable with **no deploy**: a saved rule takes effect on
 * the next chat turn, which {@link RecommendationService.recommend} reads from the same table through
 * the pure {@link evaluateRecommendation} engine.
 *
 * `recommendation_rules`/`consultation_types` are global **RLS-exempt config** (no per-tenant policy),
 * so a rule change is platform-wide. Work still runs inside {@link RlsService.run} for the transaction
 * (an upsert + its lookups are atomic) and the admin GUC, consistent with the other admin services;
 * the `@Roles("admin")` route guard is what gates the caller. Mirrors {@link EntitlementMatrixService}.
 *
 * Identity (`trigger`) is never taken from the body — only the path — so a save can't reassign a rule
 * to a different trigger (directive §4.7). Type-coherence is derived server-side (directive §4.20): a
 * keyword trigger's `threshold` is forced `null` and a threshold trigger's `keywords` is forced `[]`,
 * and an *enabled* rule that could never fire (no keywords / no threshold) or one pointing at an
 * unknown consultation type is rejected (→400).
 */
@Injectable()
export class RecommendationRulesService {
  constructor(private readonly rls: RlsService) {}

  /** Every configured rule (highest priority first) plus the consultation types a rule can point at. */
  async getRules(user: AuthUser): Promise<RecommendationRulesDto> {
    return this.rls.run(user, async (tx) => {
      const rows = await tx.recommendationRule.findMany({
        orderBy: [{ priority: "desc" }, { trigger: "asc" }],
        select: RULE_SELECT,
      });
      const types = await tx.consultationType.findMany({
        orderBy: { createdAt: "asc" },
        select: { key: true, name: true, active: true },
      });

      return {
        rules: rows.map(toRuleDto),
        consultationTypes: types satisfies RecommendationConsultationTypeDto[],
      };
    });
  }

  /**
   * Upserts one rule (keyed by its trigger) and returns its persisted value. Derives type-coherent
   * fields from the trigger, rejects an incoherent enabled rule (→400), and validates that a non-null
   * `consultationTypeKey` references an existing consultation type (→400) before writing.
   */
  async updateRule(
    user: AuthUser,
    trigger: RecommendationTriggerValue,
    input: RecommendationRuleUpdateInput,
  ): Promise<RecommendationRuleDto> {
    return this.rls.run(user, async (tx) => {
      const values = coherentRule(trigger, input);

      if (values.consultationTypeKey !== null) {
        const type = await tx.consultationType.findUnique({
          where: { key: values.consultationTypeKey },
          select: { key: true },
        });
        if (!type) {
          throw new BadRequestException("Unknown consultation type");
        }
      }

      const row = await tx.recommendationRule.upsert({
        where: { trigger },
        update: {
          enabled: values.enabled,
          threshold: values.threshold,
          keywords: values.keywords,
          priority: values.priority,
          consultationTypeKey: values.consultationTypeKey,
        },
        create: {
          trigger,
          enabled: values.enabled,
          threshold: values.threshold,
          keywords: values.keywords,
          priority: values.priority,
          consultationTypeKey: values.consultationTypeKey,
        },
        select: RULE_SELECT,
      });

      return toRuleDto(row);
    });
  }
}

/** A `recommendation_rules` row (the selected columns) → the wire DTO, deriving `kind` from `trigger`. */
function toRuleDto(row: {
  trigger: RecommendationTriggerValue;
  enabled: boolean;
  threshold: number | null;
  keywords: string[];
  priority: number;
  consultationTypeKey: string | null;
}): RecommendationRuleDto {
  return {
    trigger: row.trigger,
    enabled: row.enabled,
    threshold: row.threshold,
    keywords: row.keywords,
    priority: row.priority,
    consultationTypeKey: row.consultationTypeKey,
    kind: KEYWORD_TRIGGERS.has(row.trigger) ? "keyword" : "threshold",
  };
}

/** The values actually stored for a rule, after type-coercion + cross-field validation. */
interface CoherentRule {
  enabled: boolean;
  threshold: number | null;
  keywords: string[];
  priority: number;
  consultationTypeKey: string | null;
}

/**
 * Reconciles the submitted rule with its trigger. A **keyword** trigger (`topic`/`high_intent`) has
 * no threshold, so `threshold` is forced `null`; a **threshold** trigger (`depth`/`low_confidence`)
 * has no keywords, so `keywords` is forced `[]` (never trust the client to suppress the other field
 * — §4.20). An *enabled* rule must also be able to fire:
 *  - a keyword rule with no keywords would never match → rejected;
 *  - a threshold rule with a `null` threshold never fires (the engine treats it as silent) → rejected;
 *  - a `depth` rule needs `threshold >= 1` (the engine never fires `depth` at ≤ 0) → rejected.
 * A disabled rule skips the can-fire checks (it is off either way), but its fields are still coerced.
 */
function coherentRule(
  trigger: RecommendationTriggerValue,
  input: RecommendationRuleUpdateInput,
): CoherentRule {
  const base = {
    enabled: input.enabled,
    priority: input.priority,
    consultationTypeKey: input.consultationTypeKey,
  };

  if (KEYWORD_TRIGGERS.has(trigger)) {
    if (input.enabled && input.keywords.length === 0) {
      throw new BadRequestException("An enabled keyword rule needs at least one keyword");
    }
    return { ...base, threshold: null, keywords: input.keywords };
  }

  if (input.enabled && input.threshold === null) {
    throw new BadRequestException("An enabled threshold rule needs a threshold");
  }
  if (trigger === "depth" && input.enabled && (input.threshold ?? 0) < 1) {
    throw new BadRequestException("A depth rule's threshold must be at least 1 turn");
  }
  return { ...base, threshold: input.threshold, keywords: [] };
}
