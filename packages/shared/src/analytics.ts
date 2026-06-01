import { z } from "zod";
import type { RecommendationTriggerValue } from "./consultation";
import type { ConsultationStatusValue, RecommendationFunnelResponse } from "./expert";
import type {
  ReviewRequestStatusValue,
  ReviewTriggerModeValue,
  ReviewVerdictValue,
  ReviewVisibilityValue,
} from "./concierge";

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

/**
 * Consultation-funnel analytics wire types (M10.2, PRD §"Phase 1 — MVP" → M10 "Consultation funnel +
 * attribution"). The admin dashboard reads a single platform-wide funnel report tracing the
 * question → conversation → recommendation → booking → revenue chain: conversations started,
 * recommendations surfaced (by trigger and by user response), the consultations they produced (by
 * status), and the booked consultation revenue attributed to the funnel.
 *
 * This is the {@link ExpertConversionsDto} shape — but admin cross-tenant (the whole platform, not one
 * expert's voice). All counts cover the same trailing window; revenue stays in integer cents.
 */

/**
 * Trailing-window query for the funnel report: how many whole days (including today) it covers. Same
 * shape and bounds as {@link usageAnalyticsQuerySchema}.
 */
export const funnelAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type FunnelAnalyticsQueryInput = z.infer<typeof funnelAnalyticsQuerySchema>;

/**
 * The admin consultation-funnel report (`GET /admin/analytics/funnel`). Each stage's count covers the
 * trailing `windowDays`. The consultation stage and revenue are **attributed to the funnel** — they
 * count only consultations that arose from an in-chat recommendation (a booking made directly outside
 * the recommendation flow is not part of this funnel).
 */
export interface FunnelAnalyticsDto {
  /** Days covered by the report. */
  windowDays: number;
  /** Start of the window (UTC ISO; start-of-day of the earliest day covered). */
  since: string;
  /** Conversations started in the window — the top of the funnel (each is a question thread). */
  conversations: number;
  /** Recommendations surfaced in the window. */
  recommendations: number;
  /** Recommendations grouped by which trigger fired. */
  byTrigger: Record<RecommendationTriggerValue, number>;
  /** Recommendations grouped by the user's response (incl. the not-yet-answered `pending` default). */
  byResponse: Record<RecommendationFunnelResponse, number>;
  /** Funnel-attributed consultations (those with a recommendation) created in the window. */
  consultations: number;
  /** Those consultations grouped by status. */
  byConsultationStatus: Record<ConsultationStatusValue, number>;
  /** Booked-and-beyond consultation revenue attributed to the funnel (cents). */
  bookedRevenueCents: number;
}

/**
 * Concierge (human-in-the-loop) operations analytics wire types (M10.3, PRD §"Phase 1 — MVP" → M10
 * "concierge volume/SLA/verdict metrics; knowledge-quality signals"). The admin dashboard reads a
 * single platform-wide concierge report over the `human_review_requests` / `review_responses` ledgers
 * (M9) plus the chunk-flagging knowledge-gap signal (M9.4): how many reviews were requested (by
 * status / trigger mode / visibility), whether the team is hitting its SLA, the spread of reviewer
 * verdicts, and which published source chunks reviewers have flagged as weak.
 *
 * Read-only and OD#1-independent — the {@link UsageAnalyticsDto} / {@link FunnelAnalyticsDto}
 * cross-tenant admin shape, but over the concierge tables. All request/verdict counts cover the
 * trailing window; the knowledge-quality flag counts are **cumulative** (a chunk's `flag_count` has no
 * per-event history) — only `recentlyFlagged` is windowed via `last_flagged_at`.
 */

/**
 * Trailing-window query for the concierge report: how many whole days (including today) it covers.
 * Same shape and bounds as {@link usageAnalyticsQuerySchema}.
 */
export const conciergeAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type ConciergeAnalyticsQueryInput = z.infer<typeof conciergeAnalyticsQuerySchema>;

/** SLA adherence over the review requests created in the window. */
export interface ConciergeSlaDto {
  /** Requests that carry an SLA due date (the denominator for adherence). */
  tracked: number;
  /** Answered at or before their SLA due date. */
  met: number;
  /** Answered after their SLA due date. */
  breached: number;
  /** Still unanswered (`requested`/`in_review`) and already past their SLA due date. */
  openOverdue: number;
  /** Mean minutes from request to answer across answered requests, or null when none were answered. */
  avgResponseMinutes: number | null;
}

/** Reviewer-verdict spread over the responses recorded in the window. */
export interface ConciergeVerdictsDto {
  /** Total verdicts recorded in the window. */
  total: number;
  /** Verdicts grouped by quality call (good/bad/great), every key present. */
  byVerdict: Record<ReviewVerdictValue, number>;
  /** Responses where the reviewer edited the answer (the flywheel's voice/knowledge feed). */
  edited: number;
  /** Responses whose refined answer was delivered back to the user (M9.3 visible delivery). */
  delivered: number;
}

/** One published source chunk a reviewer flagged as weak (a knowledge-gap signal, M9.4). */
export interface ConciergeFlaggedChunkDto {
  /** The chunk id. */
  chunkId: string;
  /** The document version the chunk belongs to (provenance for re-authoring). */
  documentVersionId: string;
  /** How many times an answer grounded on this chunk was flagged `bad` (cumulative). */
  flagCount: number;
  /** When it was last flagged (ISO-8601), or null. */
  lastFlaggedAt: string | null;
  /** A short snippet of the chunk's summary/content so the operator can recognise it. */
  excerpt: string;
}

/** Knowledge-quality signals derived from the concierge `bad`-verdict chunk flagging (M9.4). */
export interface ConciergeKnowledgeQualityDto {
  /** Published chunks with at least one flag (cumulative). */
  flaggedChunks: number;
  /** Sum of every chunk's flag count (cumulative). */
  totalFlags: number;
  /** Chunks flagged within the trailing window (`last_flagged_at >= since`). */
  recentlyFlagged: number;
  /** The most-flagged chunks, highest flag count first (capped); empty when nothing is flagged. */
  topFlagged: ConciergeFlaggedChunkDto[];
}

/**
 * The admin concierge analytics report (`GET /admin/analytics/concierge`). Request/verdict counts
 * cover the trailing `windowDays`; the knowledge-quality flag counts are cumulative (see the module
 * note above).
 */
export interface ConciergeAnalyticsDto {
  /** Days covered by the request/verdict metrics. */
  windowDays: number;
  /** Start of the window (UTC ISO; start-of-day of the earliest day covered). */
  since: string;
  /** Review requests created in the window. */
  totalRequests: number;
  /** Requests grouped by lifecycle status, every key present. */
  byStatus: Record<ReviewRequestStatusValue, number>;
  /** Requests grouped by trigger mode (Mode A `user_prompted` vs Mode B `auto_silent`). */
  byTriggerMode: Record<ReviewTriggerModeValue, number>;
  /** Requests grouped by visibility (surfaced to the user vs silent shadow review). */
  byVisibility: Record<ReviewVisibilityValue, number>;
  /** SLA adherence over the window's requests. */
  sla: ConciergeSlaDto;
  /** Reviewer-verdict spread over the window's responses. */
  verdicts: ConciergeVerdictsDto;
  /** Knowledge-quality signals from chunk flagging (cumulative; see the module note). */
  knowledge: ConciergeKnowledgeQualityDto;
}
