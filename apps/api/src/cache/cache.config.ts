/**
 * Tunable sizing/TTL for the M6.4 caching layers — one place to calibrate the margin-vs-freshness
 * trade-off. Kept conservative so a cached answer can never be wildly stale relative to a knowledge
 * publish (TTL is the only invalidation today; an explicit publish-time invalidation is the M8
 * follow-up). When Memorystore Redis lands these become its config (PRD §"No full infra Day 1").
 */

/** Retrieval cache (knowledge chunks by query + scope) — short, so a re-index is reflected quickly. */
export const RETRIEVAL_CACHE = { maxEntries: 1000, ttlMs: 5 * 60 * 1000 } as const;

/** In-process answer cache (the hot tier of the answer/semantic layer). */
export const ANSWER_CACHE = { maxEntries: 1000, ttlMs: 10 * 60 * 1000 } as const;

/**
 * Max age of a persistent `semantic_cache` answer that may still be served (ms). Longer than the
 * in-process TTL because the table is the durable cross-instance tier, but bounded so a stale answer
 * ages out even without an explicit invalidation.
 */
export const SEMANTIC_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
