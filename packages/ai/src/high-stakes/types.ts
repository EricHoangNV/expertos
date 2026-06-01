/**
 * Types for the high-stakes-topic detector (NT.4, PRD §"Non-Technical Requirements").
 *
 * Some questions touch areas where a confident AI answer carries real liability — money, the law,
 * health, and tax. The PRD mandates that any answer touching these (1) is scoped to general
 * educational context (a system-prompt rule), (2) carries a disclaimer + a "book a consultation"
 * option, and (3) is logged `high_stakes = true` for monitoring. Detection is the single signal all
 * three hang off, so — like the prompt builder and the recommendation engine — it is pure and
 * deterministic (no IO/clock/RNG): a curated keyword match over the shared tokenizer, exhaustively
 * unit-testable offline and identical wherever it runs.
 */

/** The high-stakes categories the detector recognises (financial / legal / medical / tax). */
export const HIGH_STAKES_CATEGORIES = ["financial", "legal", "medical", "tax"] as const;

export type HighStakesCategory = (typeof HIGH_STAKES_CATEGORIES)[number];

/** A positive high-stakes detection: the categories that fired and the terms that matched them. */
export interface HighStakesResult {
  /** Distinct categories the text matched, in declared order (always ≥ 1 — null is returned when none). */
  categories: HighStakesCategory[];
  /** The matched keywords (deduped, in first-seen order) — for logging/monitoring, not user-facing. */
  matchedTerms: string[];
}
