import { z } from "zod";

/**
 * Usage & cost analytics wire types (M10.1, PRD §"Phase 1 — MVP" → M10 "usage & cost"). The admin
 * analytics dashboard reads a single platform-wide usage report over the `usage_logs` ledger: total
 * AI events / tokens / cost (`cost_micros`, M6.5) and distinct active users for a trailing window,
 * broken down by feature and by model, plus a trailing **daily** series.
 *
 * Read-only and OD#1-independent — this is pure *instrumentation* (the metrics), distinct from the
 * validation success criteria / kill line (M10.4, gated on Open Decision #1). All AI spend stays in
 * `cost_micros` (millionths of a USD cent) so it never loses precision crossing the wire — the
 * dashboard converts. The revenue/margin view lives separately in {@link RevenueReportDto}.
 */

/**
 * Trailing-window query: how many whole days (including today) the report covers. The series + window
 * totals are bounded by the UTC start-of-day `today - (days - 1)`.
 */
export const usageAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type UsageAnalyticsQueryInput = z.infer<typeof usageAnalyticsQuerySchema>;

/** One feature's usage rollup over the window (e.g. `chat.answer`, `retrieve.embed`). */
export interface UsageByFeatureDto {
  /** The logged `feature_key`. */
  featureKey: string;
  /** Count of usage rows for this feature. */
  events: number;
  /** Summed prompt tokens (0 when none were logged). */
  promptTokens: number;
  /** Summed completion tokens (0 when none were logged). */
  completionTokens: number;
  /** Summed AI spend for this feature, in `cost_micros`. */
  costMicros: number;
}

/** One model's usage rollup over the window. */
export interface UsageByModelDto {
  /** The logged `model` string, or `"(none)"` when the usage row named no model (e.g. a cache marker). */
  model: string;
  /** Count of usage rows attributed to this model. */
  events: number;
  /** Summed prompt tokens (0 when none were logged). */
  promptTokens: number;
  /** Summed completion tokens (0 when none were logged). */
  completionTokens: number;
  /** Summed AI spend for this model, in `cost_micros`. */
  costMicros: number;
}

/** One calendar day of usage activity (only days with at least one event). */
export interface UsagePeriodDto {
  /** Day bucket, `YYYY-MM-DD` (UTC). */
  period: string;
  /** Count of usage rows in the day. */
  events: number;
  /** AI spend booked in the day, in `cost_micros`. */
  costMicros: number;
  /** Distinct users active in the day (rows with no user are excluded). */
  activeUsers: number;
}

/**
 * The admin usage & cost report (`GET /admin/analytics/usage`). Totals + breakdowns + the daily
 * series all cover the trailing `windowDays`. `activeUsers` is a window-wide distinct count (NOT the
 * sum of the per-day `activeUsers`, which would double-count a user active on several days).
 */
export interface UsageAnalyticsDto {
  /** Days covered by the totals + series. */
  windowDays: number;
  /** Start of the window (UTC ISO; start-of-day of the earliest day covered). */
  since: string;
  /** Count of usage rows in the window. */
  totalEvents: number;
  /** Window prompt tokens. */
  promptTokens: number;
  /** Window completion tokens. */
  completionTokens: number;
  /** Window AI spend, in `cost_micros` (millionths of a USD cent). */
  totalCostMicros: number;
  /** Distinct users active anywhere in the window. */
  activeUsers: number;
  /** Per-feature rollup, highest spend first. */
  byFeature: UsageByFeatureDto[];
  /** Per-model rollup, highest spend first. */
  byModel: UsageByModelDto[];
  /** Trailing daily series (only days with activity), oldest first. */
  periods: UsagePeriodDto[];
}
