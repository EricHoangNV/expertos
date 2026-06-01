/**
 * Pure retrieval-quality metrics for the eval harness. All divisions are guarded so an empty
 * relevant set, an empty result list, or zero cases yields 0 rather than NaN/Infinity
 * (directive §9 — guard NaN/Infinity before any numeric calculation).
 */

import type { EvalCaseResult, EvalReport } from "./types";

/** The per-case scores, excluding the case id / retrieved list the caller attaches. */
type CaseMetrics = Pick<
  EvalCaseResult,
  "hit" | "recallAtK" | "precisionAtK" | "reciprocalRank"
>;

/**
 * Score one query's deduped, rank-ordered `retrievedDocIds` against its `relevantDocIds`.
 * `retrievedDocIds` must already be unique (one entry per document, best rank first).
 */
export function scoreCase(
  retrievedDocIds: string[],
  relevantDocIds: string[],
): CaseMetrics {
  const relevant = new Set(relevantDocIds);

  let firstRelevantRank = 0; // 1-based; 0 = none found
  let relevantRetrieved = 0;
  retrievedDocIds.forEach((docId, index) => {
    if (relevant.has(docId)) {
      relevantRetrieved += 1;
      if (firstRelevantRank === 0) {
        firstRelevantRank = index + 1;
      }
    }
  });

  const recallAtK = relevant.size === 0 ? 0 : relevantRetrieved / relevant.size;
  const precisionAtK =
    retrievedDocIds.length === 0 ? 0 : relevantRetrieved / retrievedDocIds.length;
  const reciprocalRank = firstRelevantRank === 0 ? 0 : 1 / firstRelevantRank;

  return { hit: firstRelevantRank > 0, recallAtK, precisionAtK, reciprocalRank };
}

/** Mean of `values`, or 0 for an empty list. */
function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregate per-case results into the report-level means and hit rate. */
export function aggregate(
  topK: number,
  embedder: string,
  cases: EvalCaseResult[],
): EvalReport {
  return {
    topK,
    embedder,
    cases,
    hitRate: mean(cases.map((c) => (c.hit ? 1 : 0))),
    meanRecallAtK: mean(cases.map((c) => c.recallAtK)),
    meanPrecisionAtK: mean(cases.map((c) => c.precisionAtK)),
    mrr: mean(cases.map((c) => c.reciprocalRank)),
  };
}
