import { Injectable } from "@nestjs/common";
import type {
  ConciergeAnalyticsDto,
  ConciergeAnalyticsQueryInput,
  ConciergeFlaggedChunkDto,
  ConsultationStatusValue,
  FunnelAnalyticsDto,
  FunnelAnalyticsQueryInput,
  RecommendationFunnelResponse,
  RecommendationTriggerValue,
  ReviewRequestStatusValue,
  ReviewTriggerModeValue,
  ReviewVerdictValue,
  ReviewVisibilityValue,
  UsageAnalyticsDto,
  UsageAnalyticsQueryInput,
  UsageByFeatureDto,
  UsageByModelDto,
  UsagePeriodDto,
} from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** Label for usage rows that logged no model (a cache/marker row, M6.4) — kept visible, not dropped. */
const NO_MODEL_LABEL = "(none)";

/** Stable key sets so every grouped count starts at zero (a `Record<Union, number>` needs all keys). */
const TRIGGERS: readonly RecommendationTriggerValue[] = [
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
];
const RESPONSES: readonly RecommendationFunnelResponse[] = [
  "pending",
  "book",
  "maybe_later",
  "ask_another",
];
const CONSULTATION_STATUSES: readonly ConsultationStatusValue[] = [
  "recommended",
  "booked",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
];

/** Statuses whose `amount_cents` count as realised/attributable booked revenue (mirrors ExpertPortal). */
const REVENUE_STATUSES: ReadonlySet<ConsultationStatusValue> = new Set([
  "booked",
  "confirmed",
  "completed",
]);

/** Concierge stable key sets (so every grouped count starts at zero, mirroring the funnel sets). */
const REVIEW_STATUSES: readonly ReviewRequestStatusValue[] = [
  "requested",
  "in_review",
  "answered",
  "escalated",
  "dismissed",
];
const TRIGGER_MODES: readonly ReviewTriggerModeValue[] = ["user_prompted", "auto_silent"];
const VISIBILITIES: readonly ReviewVisibilityValue[] = ["visible", "silent"];
const VERDICTS: readonly ReviewVerdictValue[] = ["good", "bad", "great"];

/** How many most-flagged chunks the knowledge-quality signal surfaces. */
const TOP_FLAGGED_LIMIT = 10;
/** Excerpt length for a flagged chunk's summary/content snippet. */
const EXCERPT_LEN = 160;

/** A Prisma `groupBy` rollup row over `usage_logs` (counts + token/cost sums). */
interface GroupRow {
  _count: { _all: number };
  _sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    costMicros: number | null;
  };
}

/** Raw daily-series row (Postgres `count`/`sum` come back as `BigInt` — coerced in the mapper). */
interface PeriodRow {
  period: string;
  events: bigint | number;
  cost_micros: bigint | number;
  active_users: bigint | number;
}

/** Raw window-wide distinct-active-users row. */
interface ActiveUsersRow {
  active_users: bigint | number;
}

/** Raw concierge SLA-adherence aggregate row (FILTERed counts + an average response time). */
interface SlaRow {
  tracked: bigint | number;
  met: bigint | number;
  breached: bigint | number;
  open_overdue: bigint | number;
  /** Mean request→answer seconds across answered requests (`AVG` → numeric string, or null). */
  avg_response_seconds: string | number | null;
}

/**
 * Admin usage & cost analytics (M10.1, PRD §M10 "usage & cost"). The single read-only choke point
 * behind `GET /admin/analytics/usage`; the validation success-criteria / kill-line instrument (M10.4)
 * is separate and gated on Open Decision #1 — this is OD#1-independent pure instrumentation.
 *
 * Runs inside {@link RlsService.run} under an **admin** principal, so the `is_admin` GUC makes every
 * read **platform-wide across all tenants** (the same cross-tenant visibility {@link RevenueService}
 * relies on) — that's why no `tenant_id` predicate ever appears here. The route guard
 * (`@Roles("admin")`) is what guarantees the caller is actually an admin.
 *
 * Three reads over `usage_logs`, all bounded by the trailing-window start:
 *  - **by feature + by model** — Prisma `groupBy` (counts + token/cost `_sum`). The window totals are
 *    derived by summing the by-feature rollup (every row carries a feature_key), so no extra aggregate.
 *  - **daily series** — raw SQL: `date_trunc('day')` + `count(DISTINCT user_id)` have no Prisma Client
 *    expression (the M8.3 revenue-series precedent). `count`/`sum` are `BigInt` → coerced.
 *  - **window active users** — a raw `count(DISTINCT user_id)` scalar (a window-wide distinct count
 *    can't be summed from the per-day counts without double-counting cross-day users).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly rls: RlsService) {}

  /** Build the platform usage & cost report for the trailing `query.days` window. */
  async usage(user: AuthUser, query: UsageAnalyticsQueryInput): Promise<UsageAnalyticsDto> {
    const since = windowStart(query.days, new Date());

    return this.rls.run(user, async (tx) => {
      const byFeature = await this.byFeature(tx, since);
      const byModel = await this.byModel(tx, since);
      const periods = await this.dailySeries(tx, since);
      const activeUsers = await this.activeUsers(tx, since);

      const totalEvents = byFeature.reduce((sum, f) => sum + f.events, 0);
      const promptTokens = byFeature.reduce((sum, f) => sum + f.promptTokens, 0);
      const completionTokens = byFeature.reduce((sum, f) => sum + f.completionTokens, 0);
      const totalCostMicros = byFeature.reduce((sum, f) => sum + f.costMicros, 0);

      return {
        windowDays: query.days,
        since: since.toISOString(),
        totalEvents,
        promptTokens,
        completionTokens,
        totalCostMicros,
        activeUsers,
        byFeature,
        byModel,
        periods,
      };
    });
  }

  /**
   * Build the platform consultation-funnel report for the trailing `query.days` window (M10.2). The
   * {@link ExpertPortalService} `conversions` shape, but admin cross-tenant: every count covers the
   * whole platform (the admin GUC inside {@link RlsService.run} grants the cross-tenant read, so no
   * `tenant_id` predicate appears). Traces question → conversation → recommendation → booking →
   * revenue.
   */
  async funnel(user: AuthUser, query: FunnelAnalyticsQueryInput): Promise<FunnelAnalyticsDto> {
    const since = windowStart(query.days, new Date());

    return this.rls.run(user, async (tx) => {
      const conversations = await tx.conversation.count({ where: { createdAt: { gte: since } } });

      // Recommendations surfaced in the window, broken down by trigger and by user response.
      const byTrigger = zeroCounts(TRIGGERS);
      const byResponse = zeroCounts(RESPONSES);
      let recommendations = 0;
      const recGrouped = await tx.consultationRecommendation.groupBy({
        by: ["trigger", "response"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      for (const row of recGrouped) {
        const n = row._count._all;
        recommendations += n;
        byTrigger[row.trigger] += n;
        byResponse[row.response] += n;
      }

      // Funnel-attributed consultations: those that arose from a recommendation. Booked revenue is
      // summed over the realised-status rows.
      const byConsultationStatus = zeroCounts(CONSULTATION_STATUSES);
      let consultations = 0;
      let bookedRevenueCents = 0;
      const consGrouped = await tx.consultation.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since }, recommendations: { some: {} } },
        _count: { _all: true },
        _sum: { amountCents: true },
      });
      for (const row of consGrouped) {
        const n = row._count._all;
        consultations += n;
        byConsultationStatus[row.status] += n;
        if (REVENUE_STATUSES.has(row.status)) {
          bookedRevenueCents += row._sum.amountCents ?? 0;
        }
      }

      return {
        windowDays: query.days,
        since: since.toISOString(),
        conversations,
        recommendations,
        byTrigger,
        byResponse,
        consultations,
        byConsultationStatus,
        bookedRevenueCents,
      };
    });
  }

  /**
   * Build the platform concierge analytics report for the trailing `query.days` window (M10.3, PRD
   * §M10 "concierge volume/SLA/verdict metrics; knowledge-quality signals"). Same admin cross-tenant
   * read pattern as {@link usage}/{@link funnel} (the `is_admin` GUC inside {@link RlsService.run}
   * grants the platform-wide read, so no `tenant_id` predicate appears).
   *
   *  - **volume** — one `human_review_requests` groupBy over (status, trigger_mode, visibility),
   *    folded into the three breakdowns + the window total.
   *  - **SLA** — a raw FILTERed aggregate (`count() FILTER (WHERE …)` + `avg(epoch)` have no Prisma
   *    Client expression): met/breached/open-overdue against `sla_due_at` + mean response minutes.
   *  - **verdicts** — `review_responses` grouped by verdict + windowed edited/delivered counts.
   *  - **knowledge quality** — the M9.4 chunk-flagging signal: flagged-chunk count, total flags,
   *    recently-flagged (windowed via `last_flagged_at`), and the most-flagged chunks. Flag counts are
   *    **cumulative** (a chunk's `flag_count` has no per-event history); only `recentlyFlagged` is
   *    windowed.
   */
  async concierge(
    user: AuthUser,
    query: ConciergeAnalyticsQueryInput,
  ): Promise<ConciergeAnalyticsDto> {
    const now = new Date();
    const since = windowStart(query.days, now);

    return this.rls.run(user, async (tx) => {
      // Volume: one groupBy folded into status / trigger-mode / visibility breakdowns + total.
      const byStatus = zeroCounts(REVIEW_STATUSES);
      const byTriggerMode = zeroCounts(TRIGGER_MODES);
      const byVisibility = zeroCounts(VISIBILITIES);
      let totalRequests = 0;
      const reqGrouped = await tx.humanReviewRequest.groupBy({
        by: ["status", "triggerMode", "visibility"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      for (const row of reqGrouped) {
        const n = row._count._all;
        totalRequests += n;
        byStatus[row.status as ReviewRequestStatusValue] += n;
        byTriggerMode[row.triggerMode as ReviewTriggerModeValue] += n;
        byVisibility[row.visibility as ReviewVisibilityValue] += n;
      }

      // SLA adherence (raw FILTERed aggregate). $1 = window start, $2 = now (open-overdue cutoff).
      const slaRows = await tx.$queryRawUnsafe<SlaRow[]>(SLA_SQL, since, now);
      const slaRow = slaRows[0];
      const avgSeconds = slaRow?.avg_response_seconds;
      const sla = {
        tracked: Number(slaRow?.tracked ?? 0),
        met: Number(slaRow?.met ?? 0),
        breached: Number(slaRow?.breached ?? 0),
        openOverdue: Number(slaRow?.open_overdue ?? 0),
        avgResponseMinutes: avgSeconds == null ? null : Math.round(Number(avgSeconds) / 60),
      };

      // Verdicts: grouped over the window's responses + windowed edited/delivered counts.
      const byVerdict = zeroCounts(VERDICTS);
      let verdictTotal = 0;
      const verdictGrouped = await tx.reviewResponse.groupBy({
        by: ["verdict"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
      for (const row of verdictGrouped) {
        const n = row._count._all;
        verdictTotal += n;
        byVerdict[row.verdict as ReviewVerdictValue] += n;
      }
      const edited = await tx.reviewResponse.count({
        where: { createdAt: { gte: since }, edited: true },
      });
      const delivered = await tx.reviewResponse.count({
        where: { createdAt: { gte: since }, deliveredToUser: true },
      });

      // Knowledge-quality signals (cumulative flag counts; only recentlyFlagged is windowed).
      const knowledge = await this.knowledgeQuality(tx, since);

      return {
        windowDays: query.days,
        since: since.toISOString(),
        totalRequests,
        byStatus,
        byTriggerMode,
        byVisibility,
        sla,
        verdicts: { total: verdictTotal, byVerdict, edited, delivered },
        knowledge,
      };
    });
  }

  /** Per-feature rollup, highest spend first. */
  private async byFeature(
    tx: Prisma.TransactionClient,
    since: Date,
  ): Promise<UsageByFeatureDto[]> {
    const rows = (await tx.usageLog.groupBy({
      by: ["featureKey"],
      where: { occurredAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costMicros: true },
    })) as unknown as (GroupRow & { featureKey: string })[];

    return rows
      .map((row) => ({ featureKey: row.featureKey, ...rollup(row) }))
      .sort(byCostDesc);
  }

  /** Per-model rollup, highest spend first; a null model surfaces as `"(none)"`. */
  private async byModel(tx: Prisma.TransactionClient, since: Date): Promise<UsageByModelDto[]> {
    const rows = (await tx.usageLog.groupBy({
      by: ["model"],
      where: { occurredAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costMicros: true },
    })) as unknown as (GroupRow & { model: string | null })[];

    return rows
      .map((row) => ({ model: row.model ?? NO_MODEL_LABEL, ...rollup(row) }))
      .sort(byCostDesc);
  }

  /** Trailing daily series (only days with activity), oldest first. */
  private async dailySeries(
    tx: Prisma.TransactionClient,
    since: Date,
  ): Promise<UsagePeriodDto[]> {
    const rows = await tx.$queryRawUnsafe<PeriodRow[]>(PERIOD_SQL, since);
    return rows.map((row) => ({
      period: row.period,
      events: Number(row.events),
      costMicros: Number(row.cost_micros),
      activeUsers: Number(row.active_users),
    }));
  }

  /** Distinct users with at least one usage row in the window (0 when none). */
  private async activeUsers(tx: Prisma.TransactionClient, since: Date): Promise<number> {
    const rows = await tx.$queryRawUnsafe<ActiveUsersRow[]>(ACTIVE_USERS_SQL, since);
    return Number(rows[0]?.active_users ?? 0);
  }

  /**
   * Knowledge-quality signals from the M9.4 chunk flagging. Flag counts are cumulative (a chunk's
   * `flag_count` has no per-event history); only `recentlyFlagged` is windowed via `last_flagged_at`.
   * The top list orders by flag count, then recency, so the weakest source material surfaces first.
   */
  private async knowledgeQuality(
    tx: Prisma.TransactionClient,
    since: Date,
  ): Promise<ConciergeAnalyticsDto["knowledge"]> {
    const flaggedChunks = await tx.chunk.count({ where: { flagCount: { gt: 0 } } });
    const totalAgg = await tx.chunk.aggregate({
      where: { flagCount: { gt: 0 } },
      _sum: { flagCount: true },
    });
    const recentlyFlagged = await tx.chunk.count({ where: { lastFlaggedAt: { gte: since } } });
    const top = await tx.chunk.findMany({
      where: { flagCount: { gt: 0 } },
      orderBy: [{ flagCount: "desc" }, { lastFlaggedAt: "desc" }],
      take: TOP_FLAGGED_LIMIT,
      select: {
        id: true,
        documentVersionId: true,
        flagCount: true,
        lastFlaggedAt: true,
        summary: true,
        content: true,
      },
    });

    const topFlagged: ConciergeFlaggedChunkDto[] = top.map((c) => ({
      chunkId: c.id,
      documentVersionId: c.documentVersionId,
      flagCount: c.flagCount,
      lastFlaggedAt: c.lastFlaggedAt?.toISOString() ?? null,
      excerpt: excerpt(c.summary ?? c.content),
    }));

    return {
      flaggedChunks,
      totalFlags: totalAgg._sum.flagCount ?? 0,
      recentlyFlagged,
      topFlagged,
    };
  }
}

/** A zeroed `Record<K, number>` with every key present (so callers can `+=` safely). */
function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of keys) {
    out[key] = 0;
  }
  return out;
}

/** Coalesce a groupBy row's nullable sums to safe integers. */
function rollup(row: GroupRow): {
  events: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
} {
  return {
    events: row._count._all,
    promptTokens: row._sum.promptTokens ?? 0,
    completionTokens: row._sum.completionTokens ?? 0,
    costMicros: row._sum.costMicros ?? 0,
  };
}

/** Sort comparator: highest `costMicros` first (stable on the feature/model label tie). */
function byCostDesc(a: { costMicros: number }, b: { costMicros: number }): number {
  return b.costMicros - a.costMicros;
}

/** A single-line, collapsed-whitespace snippet of chunk text, capped with an ellipsis. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LEN ? `${flat.slice(0, EXCERPT_LEN).trimEnd()}…` : flat;
}

/**
 * The UTC start of the trailing window: start-of-day `days - 1` days before today. `days = 1` → the
 * start of today; `days = 30` → 29 days back. Mirrors {@link RevenueService}'s month windowing but at
 * day granularity (usage is far higher volume than the monthly ledger).
 */
function windowStart(days: number, now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)),
  );
}

/**
 * Trailing daily usage series. `$1` = window start (inclusive). Buckets `usage_logs` by
 * `date_trunc('day', occurred_at)`: event count, summed `cost_micros`, and distinct active users
 * (rows with a null `user_id` — e.g. system embeds — don't count toward active users). RLS scopes the
 * table (admin GUC → all tenants); no `tenant_id` predicate appears. `count`/`sum` are `bigint` →
 * coerced with `Number()` in the mapper.
 */
const PERIOD_SQL = `
  SELECT
    to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS period,
    count(*) AS events,
    coalesce(sum(cost_micros), 0) AS cost_micros,
    count(DISTINCT user_id) AS active_users
  FROM usage_logs
  WHERE occurred_at >= $1
  GROUP BY 1
  ORDER BY 1`;

/** Window-wide distinct active users. `$1` = window start (inclusive). RLS scopes the table. */
const ACTIVE_USERS_SQL = `
  SELECT count(DISTINCT user_id) AS active_users
  FROM usage_logs
  WHERE occurred_at >= $1`;

/**
 * Concierge SLA adherence over the requests created in the window. `$1` = window start (inclusive),
 * `$2` = now (the open-overdue cutoff). `count() FILTER (WHERE …)` and `avg(epoch …)` have no Prisma
 * Client expression, so this is raw (constant SQL, both args bound). RLS scopes the table (admin GUC →
 * all tenants); no `tenant_id` predicate appears. The status-literal comparisons cast to the
 * `review_request_status` enum. `count`s are `bigint`; the average is `numeric` (or null when nothing
 * was answered) — both coerced in the mapper.
 */
const SLA_SQL = `
  SELECT
    count(*) FILTER (WHERE sla_due_at IS NOT NULL) AS tracked,
    count(*) FILTER (WHERE answered_at IS NOT NULL AND sla_due_at IS NOT NULL AND answered_at <= sla_due_at) AS met,
    count(*) FILTER (WHERE answered_at IS NOT NULL AND sla_due_at IS NOT NULL AND answered_at > sla_due_at) AS breached,
    count(*) FILTER (WHERE answered_at IS NULL AND sla_due_at IS NOT NULL AND sla_due_at < $2 AND status IN ('requested', 'in_review')) AS open_overdue,
    avg(extract(epoch FROM (answered_at - created_at))) FILTER (WHERE answered_at IS NOT NULL) AS avg_response_seconds
  FROM human_review_requests
  WHERE created_at >= $1`;
