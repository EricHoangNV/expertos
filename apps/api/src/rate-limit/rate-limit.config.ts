/**
 * Tunable sizing for the M11.2 HTTP rate limiter — one place to calibrate the coarse anti-abuse /
 * DoS safety net. This is the per-IP request ceiling that complements the per-user metered quota
 * (M6.1 entitlements): the entitlement guard bounds how many *answers* a signed-in user may consume,
 * while this guard bounds raw request volume from a single client (including unauthenticated traffic
 * to the public webhook/auth routes) so a burst can't exhaust token-verification / HMAC work.
 *
 * In-process by design (PRD §"No full infra Day 1": start with an in-process LRU + Postgres-backed
 * counters; introduce Memorystore Redis only when volume justifies it). The swap point is the
 * {@link LruCache} the service holds — replace it with a Redis-backed store behind the same shape and
 * the limiter becomes cross-instance.
 */

/** DI token for the resolved {@link RateLimitOptions} (env-tunable, see {@link resolveRateLimitOptions}). */
export const RATE_LIMIT_OPTIONS = "RATE_LIMIT_OPTIONS";

export interface RateLimitOptions {
  /** Fixed-window length in milliseconds. */
  windowMs: number;
  /** Max requests permitted per key (client IP) within a window. */
  max: number;
  /** Upper bound on distinct keys tracked at once (memory guard against an IP-spray). */
  maxTrackedKeys: number;
  /** Clock seam (defaults to `Date.now`) so window math is deterministic in tests. */
  now?: () => number;
}

/** Launch defaults: 300 requests / 60s per IP, tracking up to 50k IPs. */
const DEFAULTS = { windowMs: 60_000, max: 300, maxTrackedKeys: 50_000 } as const;

/**
 * Resolves the limiter config from the environment, falling back to {@link DEFAULTS}. A non-positive
 * or unparseable override is ignored (fall back) so a typo can never disable the limiter or set a
 * zero window. `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `RATE_LIMIT_MAX_KEYS` are the knobs.
 */
export function resolveRateLimitOptions(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitOptions {
  return {
    windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, DEFAULTS.windowMs),
    max: positiveInt(env.RATE_LIMIT_MAX, DEFAULTS.max),
    maxTrackedKeys: positiveInt(env.RATE_LIMIT_MAX_KEYS, DEFAULTS.maxTrackedKeys),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
