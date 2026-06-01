import { Injectable } from "@nestjs/common";
import type {
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
