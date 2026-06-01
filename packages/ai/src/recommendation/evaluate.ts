import { tokenize } from "../text";
import {
  RECOMMENDATION_TRIGGERS,
  type RecommendationOutcome,
  type RecommendationRule,
  type RecommendationSignals,
} from "./types";

/**
 * The single recommendation-rules choke point (M7.1, PRD §"Consultation funnel"). Pure and
 * deterministic — like {@link buildAnswerPrompt} and {@link fuseHybrid} — so it can be exhaustively
 * unit-tested offline and reused identically across the chat seam and (later) the analytics replay.
 *
 * Evaluates every enabled rule against the turn's signals, collects the rules that fired, and
 * surfaces exactly one recommendation: the highest-`priority` fired rule (ties broken by the
 * declared trigger order, so the result is stable). Returns null when no rule fires — the common
 * case, so a normal grounded answer doesn't nag the user with an upsell.
 *
 * Trigger semantics:
 * - `high_intent` — a configured intent phrase ("book", "hire", "work with you") appears in the
 *   *question*: the user is asking to engage, so route them to booking.
 * - `topic` — a configured high-stakes term (legal/tax/medical-adjacent) appears in the question or
 *   answer: per the PRD, steer these toward a human rather than a confident AI answer.
 * - `low_confidence` — the answer was insufficient-knowledge, or cited at most `threshold` sources:
 *   the AI couldn't ground a strong answer, so offer the human path (M3.4's graceful next step).
 * - `depth` — the conversation has reached `threshold` assistant turns: an engaged user who keeps
 *   asking is a high-intent consultation candidate.
 */
export function evaluateRecommendation(
  signals: RecommendationSignals,
  rules: RecommendationRule[],
): RecommendationOutcome | null {
  const fired: Array<{ rule: RecommendationRule; matchedKeyword: string | null }> = [];
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const match = matchRule(rule, signals);
    if (match.fired) {
      fired.push({ rule, matchedKeyword: match.matchedKeyword });
    }
  }
  if (fired.length === 0) {
    return null;
  }

  // Highest priority wins; the declared trigger order is the deterministic tie-break so two rules
  // configured at the same priority always resolve the same way (the admin tunes priority to steer).
  fired.sort(
    (a, b) =>
      b.rule.priority - a.rule.priority ||
      triggerOrder(a.rule.trigger) - triggerOrder(b.rule.trigger),
  );
  const winner = fired[0];
  return {
    trigger: winner.rule.trigger,
    consultationTypeKey: winner.rule.consultationTypeKey,
    matchedKeyword: winner.matchedKeyword,
  };
}

/** Evaluates one rule's predicate against the signals, returning whether it fired (+ matched term). */
function matchRule(
  rule: RecommendationRule,
  signals: RecommendationSignals,
): { fired: boolean; matchedKeyword: string | null } {
  switch (rule.trigger) {
    case "high_intent": {
      const matched = firstKeywordIn(signals.question, rule.keywords);
      return { fired: matched !== null, matchedKeyword: matched };
    }
    case "topic": {
      const matched = firstKeywordIn(`${signals.question} ${signals.answer}`, rule.keywords);
      // High-stakes detection (NT.4) is the canonical topic signal: fire on it even when the admin
      // configured no keywords, so the consultation CTA always accompanies the high-stakes disclaimer.
      return { fired: matched !== null || signals.highStakes, matchedKeyword: matched };
    }
    case "depth": {
      // A null/≤0 threshold can never fire — an unconfigured depth rule must not nag every turn.
      const min = rule.threshold ?? 0;
      return { fired: min > 0 && signals.assistantTurnCount >= min, matchedKeyword: null };
    }
    case "low_confidence": {
      const max = rule.threshold ?? 0;
      const low = signals.insufficientKnowledge || signals.citationCount <= max;
      return { fired: low, matchedKeyword: null };
    }
  }
}

/**
 * Whole-word keyword search over the shared tokenizer (so "tax" matches "income tax" but not
 * "syntax", and a multi-word phrase matches a contiguous run). Reuses {@link tokenize} — the same
 * NFC+lowercase letter/number tokenizer the embedder and eval use — so keyword matching can never
 * drift from the rest of the text pipeline (Vietnamese diacritics stay whole, directive §36).
 * Returns the original keyword string that matched (for the recommendation reason), or null.
 */
function firstKeywordIn(text: string, keywords: string[]): string | null {
  const hay = ` ${tokenize(text).join(" ")} `;
  for (const raw of keywords) {
    const needleTokens = tokenize(raw);
    if (needleTokens.length === 0) {
      continue;
    }
    if (hay.includes(` ${needleTokens.join(" ")} `)) {
      return raw;
    }
  }
  return null;
}

/** Position of a trigger in the declared order — the deterministic priority tie-break. */
function triggerOrder(trigger: RecommendationRule["trigger"]): number {
  return RECOMMENDATION_TRIGGERS.indexOf(trigger);
}
