import { Injectable } from "@nestjs/common";
import type {
  RevenueByPlanDto,
  RevenuePeriodDto,
  RevenueReportDto,
  RevenueReportQueryInput,
} from "@expertos/shared";
import type { BillingInterval, Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** Subscription statuses that count toward MRR (mirrors the entitlement resolver's `LIVE_STATUSES`). */
const LIVE_STATUSES = ["active", "trialing"] as const;

/** `cost_micros` per USD cent — the unit conversion for the margin signal (M6.5). */
const MICROS_PER_CENT = 1_000_000;

/** A live-subscription tally for one (plan, interval), the unit MRR is summed from. */
interface LiveCountRow {
  planId: string;
  interval: BillingInterval;
  _count: { _all: number };
}

/** Raw monthly ledger row (Postgres `sum`/`count` come back as `BigInt` — coerced in the mapper). */
interface PeriodRow {
  period: string;
  gross_cents: bigint | number;
  refunded_cents: bigint | number;
  txn_count: bigint | number;
}

/**
 * Admin revenue reporting (M8.3, PRD §"Admin" → "basic revenue reports"). The single read-only
 * choke point behind `GET /admin/revenue/report`; the heavy reconciliation dashboard is Phase 2.
 *
 * Runs inside {@link RlsService.run} under an **admin** principal, so the `is_admin` GUC makes every
 * read **platform-wide across all tenants** (the same cross-tenant visibility the conversation-search
 * and other admin paths rely on) — that's why no `tenant_id` predicate ever appears here. The route
 * guard (`@Roles("admin")`) is what guarantees the caller is actually an admin.
 *
 * Three sources are combined:
 *  - **MRR + per-plan + active subscribers** — live `subscriptions` grouped by (plan, interval),
 *    priced from `plan_prices` and normalized to a monthly amount (yearly ÷ 12). Prisma Client.
 *  - **Trailing monthly series + window totals** — `transactions` bucketed by `date_trunc('month')`.
 *    Raw SQL: `date_trunc`/`FILTER` have no Prisma Client expression (the M3.3 search precedent).
 *  - **AI cost** — `usage_logs.cost_micros` summed over the window (M6.5), turned into a margin.
 */
@Injectable()
export class RevenueService {
  constructor(private readonly rls: RlsService) {}

  /** Build the platform revenue report for the trailing `query.months` window. */
  async report(user: AuthUser, query: RevenueReportQueryInput): Promise<RevenueReportDto> {
    const since = windowStart(query.months, new Date());

    return this.rls.run(user, async (tx) => {
      const { mrrCents, activeSubscriptions, byPlan } = await this.subscriptionRevenue(tx);
      const periods = await this.monthlySeries(tx, since);
      const aiCostMicros = await this.aiCost(tx, since);

      const grossCents = periods.reduce((sum, p) => sum + p.grossCents, 0);
      const refundedCents = periods.reduce((sum, p) => sum + p.refundedCents, 0);
      const netCents = grossCents - refundedCents;
      const marginCents = netCents - Math.round(aiCostMicros / MICROS_PER_CENT);

      return {
        windowMonths: query.months,
        since: since.toISOString(),
        mrrCents,
        activeSubscriptions,
        grossCents,
        refundedCents,
        netCents,
        aiCostMicros,
        marginCents,
        byPlan,
        periods,
      };
    });
  }

  /**
   * MRR snapshot from live subscriptions × plan prices. Counts are grouped by (plan, interval); each
   * group's monthly contribution is its price normalized to a month (yearly ÷ 12). A group whose
   * (plan, interval) has no configured price contributes 0 (it still counts as an active subscriber).
   */
  private async subscriptionRevenue(tx: Prisma.TransactionClient): Promise<{
    mrrCents: number;
    activeSubscriptions: number;
    byPlan: RevenueByPlanDto[];
  }> {
    const counts = (await tx.subscription.groupBy({
      by: ["planId", "interval"],
      where: { status: { in: [...LIVE_STATUSES] } },
      _count: { _all: true },
    })) as unknown as LiveCountRow[];

    const plans = await tx.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: "desc" },
      select: {
        id: true,
        key: true,
        name: true,
        prices: { select: { interval: true, amountCents: true } },
      },
    });

    let mrrCents = 0;
    let activeSubscriptions = 0;
    const byPlan: RevenueByPlanDto[] = [];

    for (const plan of plans) {
      const priceByInterval = new Map<BillingInterval, number>(
        plan.prices.map((p) => [p.interval, p.amountCents]),
      );
      let planMrr = 0;
      let planActive = 0;
      for (const row of counts) {
        if (row.planId !== plan.id) {
          continue;
        }
        const count = row._count._all;
        planActive += count;
        planMrr += monthlyAmount(row.interval, priceByInterval.get(row.interval) ?? 0) * count;
      }
      mrrCents += planMrr;
      activeSubscriptions += planActive;
      byPlan.push({
        planKey: plan.key,
        planName: plan.name,
        activeSubscriptions: planActive,
        mrrCents: planMrr,
      });
    }

    return { mrrCents, activeSubscriptions, byPlan };
  }

  /** Trailing monthly ledger series (only months with activity), oldest first. */
  private async monthlySeries(
    tx: Prisma.TransactionClient,
    since: Date,
  ): Promise<RevenuePeriodDto[]> {
    const rows = await tx.$queryRawUnsafe<PeriodRow[]>(PERIOD_SQL, since);
    return rows.map((row) => {
      const grossCents = Number(row.gross_cents);
      const refundedCents = Number(row.refunded_cents);
      return {
        period: row.period,
        grossCents,
        refundedCents,
        netCents: grossCents - refundedCents,
        transactionCount: Number(row.txn_count),
      };
    });
  }

  /** Window AI spend in `cost_micros` (0 when nothing was logged). */
  private async aiCost(tx: Prisma.TransactionClient, since: Date): Promise<number> {
    const agg = await tx.usageLog.aggregate({
      _sum: { costMicros: true },
      where: { occurredAt: { gte: since } },
    });
    return agg._sum.costMicros ?? 0;
  }
}

/** Normalize a price to a monthly amount in cents (yearly ÷ 12, rounded; monthly as-is). */
function monthlyAmount(interval: BillingInterval, amountCents: number): number {
  return interval === "year" ? Math.round(amountCents / 12) : amountCents;
}

/**
 * The UTC start of the trailing window: the first day of the month `months - 1` months before the
 * current month. `months = 1` → the start of the current month; `months = 12` → 11 months back.
 */
function windowStart(months: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

/**
 * Trailing monthly revenue series. `$1` = window start (inclusive). Buckets succeeded transactions by
 * `date_trunc('month', occurred_at)`: gross = succeeded non-refund amounts; refunded = refund-type or
 * refunded-status amounts (absolute, so a stored sign convention can't flip the total). `netCents` is
 * derived in JS. RLS scopes the table (admin GUC → all tenants); no `tenant_id` predicate appears.
 * Postgres `sum`/`count` are `bigint` → coerced with `Number()` in the mapper.
 */
const PERIOD_SQL = `
  SELECT
    to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS period,
    coalesce(sum(amount_cents) FILTER (
      WHERE status = 'succeeded'::transaction_status AND type <> 'refund'::transaction_type
    ), 0) AS gross_cents,
    coalesce(sum(abs(amount_cents)) FILTER (
      WHERE type = 'refund'::transaction_type OR status = 'refunded'::transaction_status
    ), 0) AS refunded_cents,
    count(*) FILTER (WHERE status = 'succeeded'::transaction_status) AS txn_count
  FROM transactions
  WHERE occurred_at >= $1
  GROUP BY 1
  ORDER BY 1`;
