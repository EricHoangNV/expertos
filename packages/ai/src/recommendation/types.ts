/**
 * Types for the consultation-recommendation rules engine (M7.1, PRD §"Consultation funnel").
 *
 * The engine is pure and deterministic (no IO/clock/RNG), like the prompt builder and the fusion
 * ranker: it takes the observable signals of one finished chat turn plus the admin-configured rules
 * and decides whether — and with which trigger — to recommend booking a consultation. The rules
 * themselves are config (the `recommendation_rules` table, seeded then admin-editable), never
 * hardcoded here, so the funnel can be tuned with no deploy.
 */

/** The admin-configurable triggers the recommendation engine can fire on (M7.1). */
export const RECOMMENDATION_TRIGGERS = [
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
] as const;

export type RecommendationTrigger = (typeof RECOMMENDATION_TRIGGERS)[number];

/**
 * One admin-configured rule (mirrors a `recommendation_rules` row). The engine reads these; it
 * never embeds the thresholds or keyword lists itself.
 */
export interface RecommendationRule {
  trigger: RecommendationTrigger;
  /** Disabled rules are skipped entirely (an off rule never fires). */
  enabled: boolean;
  /**
   * Threshold rules only: `depth` = the minimum assistant turns before firing; `low_confidence` =
   * the maximum citation count still treated as "low". Null (or ≤ 0 for `depth`) = the rule cannot
   * fire on the threshold alone, so an unconfigured threshold rule stays silent.
   */
  threshold: number | null;
  /**
   * Keyword rules only: match terms for `topic` (matched in the question *and* answer) and
   * `high_intent` (matched in the question only). Matched whole-word over the shared tokenizer, so
   * "tax" matches "income tax" but not "syntax"; multi-word phrases match a contiguous run.
   */
  keywords: string[];
  /** Higher wins when several rules fire on the same turn — only one recommendation is surfaced. */
  priority: number;
  /** Which consultation type to recommend; carried through unchanged for the caller to resolve. */
  consultationTypeKey: string | null;
}

/** The observable signals of one finished chat turn the engine evaluates the rules against. */
export interface RecommendationSignals {
  /** The user's question (already NFC-normalized at the API boundary). */
  question: string;
  /** The generated answer text. */
  answer: string;
  /** How many sources the answer cited (0 = ungrounded). */
  citationCount: number;
  /** True when retrieval found nothing to ground on — the insufficient-knowledge path (M3.4). */
  insufficientKnowledge: boolean;
  /** Assistant turns in this conversation *including* the one just produced (always ≥ 1). */
  assistantTurnCount: number;
  /**
   * True when the question hit the high-stakes detector (financial / legal / medical / tax — NT.4).
   * The `topic` trigger fires on this as well as on its configured keywords, so the consultation CTA
   * reliably accompanies the legal disclaimer even when an admin left the topic rule's keyword list
   * empty. A disabled topic rule still never fires (the admin's explicit opt-out).
   */
  highStakes: boolean;
}

/** A fired recommendation: which rule won, the type to book, and the matched term (if a keyword rule). */
export interface RecommendationOutcome {
  trigger: RecommendationTrigger;
  /** The winning rule's configured consultation type, or null to fall back to the active default. */
  consultationTypeKey: string | null;
  /** The keyword that matched for `topic`/`high_intent`; null for the threshold triggers. */
  matchedKeyword: string | null;
}
