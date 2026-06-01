/**
 * Per-token model pricing — the unit-economics cost model (Open Decision #4, M6.5).
 *
 * Before M6.5 cost was *logged* (token counts on `usage_logs`) but never *modeled* — `cost_micros`
 * was always null, so no one could answer OD#4's core question ("at what volume does a premium user
 * go cost-negative?"). This table is the missing model: it prices every model the system records
 * usage for, so {@link UsageLogService} can stamp a real `cost_micros` on each row and the M10
 * analytics / billing reconciliation have a margin signal to work with.
 *
 * Unit: `cost_micros` = millionths of a USD cent (matches `usage_logs.cost_micros`, an integer):
 *   $1 = 100 cents = 100_000_000 micros, so 1 USD cent = 1_000_000 micros.
 * A model advertised at $P per 1,000,000 tokens therefore costs **P × 100 micros per token**
 * ($P → P×100 cents per 1M tokens → ÷1M tokens → P×100 micros/token). {@link perMillion} encodes that.
 *
 * The USD/1M-token figures below are the *representative prod prices* the OD#4 seed matrix is
 * calibrated against (the offline `echo-*` dev providers are priced onto the same tiers so local
 * usage logs show realistic, non-zero cost). When the real LLM/embedding driver lands, update the
 * model ids + rates here — this is the single place the cost model lives.
 */

/** Cost rate for one model, in micros (millionths of a USD cent) per token. */
interface ModelRate {
  promptMicrosPerToken: number;
  completionMicrosPerToken: number;
}

/** USD per 1,000,000 tokens → micros per token (the conversion is ×100; see file header). */
const perMillion = (usdPerMillionTokens: number): number => Math.round(usdPerMillionTokens * 100);

// Pricing tiers (USD / 1M tokens), per the OD#4 model. See PRD §"Open Decisions" #4 for the
// worked margin analysis these rates feed.
//   STANDARD  — Free/Plus answer model + the offline `echo-dev` default.
//   PREMIUM   — Premium-tier answer model: ~20× STANDARD, the cost that makes the fair-use
//               degrade threshold load-bearing for margin.
//   MINI      — the degraded ("degrade, don't block", M6.3) model + `echo-dev-mini`: well below
//               STANDARD so a heavy premium user past the soft threshold costs almost nothing.
//   EMBEDDING — retrieval/ingestion embeds: negligible per answer, modeled for completeness.
const STANDARD: ModelRate = {
  promptMicrosPerToken: perMillion(0.15),
  completionMicrosPerToken: perMillion(0.6),
};
const PREMIUM: ModelRate = {
  promptMicrosPerToken: perMillion(3.0),
  completionMicrosPerToken: perMillion(15.0),
};
const MINI: ModelRate = {
  promptMicrosPerToken: perMillion(0.05),
  completionMicrosPerToken: perMillion(0.4),
};
const EMBEDDING: ModelRate = {
  promptMicrosPerToken: perMillion(0.02),
  completionMicrosPerToken: 0,
};

/**
 * Model id → cost rate. Keyed by the `model` string callers already log (provider `.name`), so no
 * caller changes when a real driver swaps in — only this map does.
 */
const MODEL_PRICING: Record<string, ModelRate> = {
  // Offline dev providers (priced onto prod tiers for realistic local logs).
  "echo-dev": STANDARD,
  "echo-dev-mini": MINI,
  "hashing-dev": EMBEDDING,
  // Default providers (OpenAI).
  "gpt-4o-mini": STANDARD,
  "gpt-4o": PREMIUM,
  "text-embedding-3-small": EMBEDDING,
  // Backup providers (Anthropic + Google).
  "claude-haiku-4-5": STANDARD,
  "claude-sonnet-4-6": PREMIUM,
  "text-embedding-004": EMBEDDING,
};

/** Unknown model → priced at the standard tier so an unrecognised model is never silently free. */
const DEFAULT_RATE = STANDARD;

/**
 * Modeled cost of one call, in `cost_micros`. Unknown models fall back to the standard tier
 * (never zero), so a missing price entry under-reports margin rather than hiding cost entirely.
 */
export function costMicrosFor(
  model: string,
  promptTokens = 0,
  completionTokens = 0,
): number {
  const rate = MODEL_PRICING[model] ?? DEFAULT_RATE;
  return promptTokens * rate.promptMicrosPerToken + completionTokens * rate.completionMicrosPerToken;
}
