/**
 * Tunable retention windows for the NT.3 data-retention sweeper — one place to calibrate how long
 * each auto-deleted data class is kept before {@link import("./retention.service").RetentionService}
 * reclaims it. Defaults are the published policy values (PRD §"Non-Technical Requirements" →
 * "Data Retention & Deletion Policy"): conversation history and usage logs are kept 2 years.
 *
 * Temporary uploads are **not** configured here — their retention is the `expires_at` stamped on each
 * row at upload time (M5.2), which is authoritative, so the sweep honours the per-row stamp rather
 * than a global window. That keeps the upload TTL a single source of truth even if it later varies.
 */

/** DI token for the resolved {@link RetentionPolicy}. */
export const RETENTION_POLICY = "RETENTION_POLICY";

export interface RetentionPolicy {
  /** Conversations idle (by `updatedAt`) longer than this many days are purged. */
  conversationDays: number;
  /** Usage-log rows older than this many days (by `occurredAt`) are purged. */
  usageLogDays: number;
  /** Clock seam (defaults to `Date.now`) so cutoff math is deterministic in tests. */
  now?: () => number;
}

/** Published-policy defaults: 2-year retention for conversation history and usage logs. */
const DEFAULTS = { conversationDays: 730, usageLogDays: 730 } as const;

/**
 * Resolves the retention windows from the environment, falling back to {@link DEFAULTS}. A
 * non-positive or unparseable override is ignored (fall back) so a typo can never collapse the
 * window to zero and purge live data. `RETENTION_CONVERSATION_DAYS` / `RETENTION_USAGE_LOG_DAYS`
 * are the knobs.
 */
export function resolveRetentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    conversationDays: positiveInt(env.RETENTION_CONVERSATION_DAYS, DEFAULTS.conversationDays),
    usageLogDays: positiveInt(env.RETENTION_USAGE_LOG_DAYS, DEFAULTS.usageLogDays),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
