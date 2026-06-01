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

/**
 * Product-validation analytics wire types (M10.4, PRD §"Open Decisions" #1 — "Validation success
 * criteria & kill line"). The consolidated go/no-go scorecard the PM reviews to answer the core
 * hypothesis ("will users pay to talk to a digital Expert X"). Per the OD#1 resolution it **surfaces
 * raw numbers, not thresholds** — targets are set post-launch once real usage exists.
 *
 * One platform-wide read (admin cross-tenant RLS, same shape as {@link UsageAnalyticsDto}) folding the
 * four validation dimensions the PRD names:
 *  - **activation** — did new users reach a cited answer early (≥1 cited answer within 24h of signup)?
 *  - **engagement** — are active users asking questions, and does the new cohort come back (1–7 days)?
 *  - **willingness to pay** — what share of users hold a paid subscription (free → paid)?
 *  - **funnel** — recommendation → booking conversion + booked consultation revenue per buyer.
 *
 * The activation/engagement/funnel dimensions are **windowed** by `windowDays`; willingness-to-pay is
 * **cumulative** (a current-state stock — paying users vs all users — like the concierge
 * knowledge-quality flag counts). Every rate is a fraction in `[0, 1]` (the dashboard renders the %),
 * `0` when its denominator is empty; revenue stays in integer cents.
 */
export const validationAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type ValidationAnalyticsQueryInput = z.infer<typeof validationAnalyticsQuerySchema>;

/** Activation: did the new-user cohort reach a cited answer early? (Windowed by signup date.) */
export interface ValidationActivationDto {
  /** Users (role `user`) who signed up in the window — the cohort denominator. */
  newUsers: number;
  /** Of those, how many received ≥1 cited answer within 24h of signing up. */
  activatedUsers: number;
  /** `activatedUsers / newUsers`, a fraction in `[0, 1]` (0 when no new users). */
  activationRate: number;
}

/** Engagement + early retention over the window. */
export interface ValidationEngagementDto {
  /** Distinct users who asked ≥1 question (a `user`-role message) in the window. */
  activeUsers: number;
  /** Total questions (user-role messages) asked in the window. */
  totalQuestions: number;
  /** Median questions per active user over the window (0 when no active users). */
  medianQuestionsPerActiveUser: number;
  /** New-cohort users who came back 1–7 days after signup (asked a question again). */
  returnedUsers: number;
  /** `returnedUsers / newUsers`, a fraction in `[0, 1]` (0 when no new users). */
  returnRate: number;
}

/** Willingness to pay — cumulative current-state platform stock (NOT windowed). */
export interface ValidationWtpDto {
  /** All users (role `user`) on the platform — the conversion denominator. */
  totalUsers: number;
  /** Users with an `active` subscription on a non-free plan. */
  payingUsers: number;
  /** Users with a `trialing` subscription on a non-free plan. */
  trialingUsers: number;
  /** `payingUsers / totalUsers`, a fraction in `[0, 1]` (0 when no users). */
  freeToPaidRate: number;
}

/** Funnel conversion + booked consultation revenue per buyer over the window. */
export interface ValidationFunnelDto {
  /** Recommendations surfaced in the window. */
  recommendations: number;
  /** Funnel-attributed consultations that reached booked/confirmed/completed in the window. */
  bookings: number;
  /** `bookings / recommendations`, a fraction in `[0, 1]` (0 when no recommendations). */
  recommendationToBookingRate: number;
  /** Booked-and-beyond consultation revenue attributed to the funnel (cents). */
  bookedRevenueCents: number;
  /** Distinct users who paid for a funnel-attributed consultation (the revenue-per-user denominator). */
  bookingUsers: number;
  /** `bookedRevenueCents / bookingUsers`, integer cents (0 when no buyers). */
  revenuePerBookingUserCents: number;
}

/**
 * The admin product-validation report (`GET /admin/analytics/validation`, M10.4). Activation,
 * engagement, and funnel cover the trailing `windowDays`; willingness-to-pay is cumulative (see the
 * module note above).
 */
export interface ValidationAnalyticsDto {
  /** Days covered by the windowed dimensions (activation / engagement / funnel). */
  windowDays: number;
  /** Start of the window (UTC ISO; start-of-day of the earliest day covered). */
  since: string;
  /** Activation: new-user cohort reaching a cited answer early. */
  activation: ValidationActivationDto;
  /** Engagement + early retention. */
  engagement: ValidationEngagementDto;
  /** Willingness to pay (cumulative). */
  willingnessToPay: ValidationWtpDto;
  /** Funnel conversion + revenue per buyer. */
  funnel: ValidationFunnelDto;
}

// Cache effectiveness (M11.3) ────────────────────────────────────────────────

/**
 * One cache layer's effectiveness snapshot. Mirrors the API's in-process `LruCache` stats — counters
 * are cumulative since process start. The two LRU layers (retrieval + answer-memory) report this
 * shape directly; the persistent semantic tier reports the `hitRate`-bearing subset.
 */
export interface CacheLayerStatsDto {
  /** Live entries currently held. `null` for the persistent semantic tier (size lives in Postgres). */
  size: number | null;
  /** Configured in-process capacity. `null` for the persistent semantic tier. */
  maxEntries: number | null;
  /** Lookups that returned a live value. */
  hits: number;
  /** Lookups that found nothing live. */
  misses: number;
  /** Entries dropped by the capacity ceiling (in-process layers only; `0` for semantic). */
  evictions: number;
  /** Misses caused by a TTL expiry specifically (in-process layers only; `0` for semantic). */
  expirations: number;
  /** `hits / (hits + misses)`, a fraction in `[0, 1]` (0 before any lookup). */
  hitRate: number;
}

/**
 * The admin cache-effectiveness report (`GET /admin/analytics/cache`, M11.3) — the observability the
 * caching tuning turns on. **Per-instance**: the caches are in-process, so this reflects only the
 * instance that served the request (fine for a single-instance load smoke; a multi-instance
 * deployment reports per-instance rates). Counters are cumulative since that instance started.
 */
export interface CacheAnalyticsDto {
  /** Retrieval layer: query + scope → knowledge chunks (skips the embed + vector/keyword search). */
  retrieval: CacheLayerStatsDto;
  /** Answer in-process hot tier: query + scope + voice + language + model → resolved answer. */
  answerMemory: CacheLayerStatsDto;
  /** Persistent semantic tier: the durable cross-instance answer cache, consulted on a memory miss. */
  semantic: CacheLayerStatsDto;
  /** Combined answer effectiveness across both answer tiers (the headline number for tuning). */
  answerOverall: {
    /** Total answer lookups (every chat turn that consults the cache). */
    lookups: number;
    /** Lookups served from either answer tier (memory hits + semantic hits). */
    served: number;
    /** `served / lookups`, a fraction in `[0, 1]` (0 before any lookup). */
    hitRate: number;
  };
}
