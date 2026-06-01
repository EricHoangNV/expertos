import { RevenueService } from "./revenue.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb-admin",
  email: "admin@expertos.local",
  displayName: "Admin",
  role: "admin",
  locale: "en",
};

function makeTx() {
  return {
    subscription: { groupBy: jest.fn().mockResolvedValue([]) },
    plan: { findMany: jest.fn().mockResolvedValue([]) },
    usageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costMicros: null } }) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new RevenueService(rls), run };
}

describe("RevenueService.report", () => {
  it("combines MRR, per-plan, monthly series, and the AI-cost margin", async () => {
    const tx = makeTx();
    tx.subscription.groupBy.mockResolvedValue([
      { planId: "plan-plus", interval: "month", _count: { _all: 3 } },
      { planId: "plan-premium", interval: "month", _count: { _all: 2 } },
      { planId: "plan-premium", interval: "year", _count: { _all: 1 } },
    ]);
    tx.plan.findMany.mockResolvedValue([
      {
        id: "plan-premium",
        key: "premium",
        name: "Premium",
        prices: [
          { interval: "month", amountCents: 999 },
          { interval: "year", amountCents: 6999 },
        ],
      },
      {
        id: "plan-plus",
        key: "plus",
        name: "Plus",
        prices: [{ interval: "month", amountCents: 499 }],
      },
    ]);
    // Postgres returns sum/count as BigInt — the mapper must coerce with Number().
    tx.$queryRawUnsafe.mockResolvedValue([
      { period: "2026-05", gross_cents: 1497n, refunded_cents: 0n, txn_count: 3n },
      { period: "2026-06", gross_cents: 2496n, refunded_cents: 499n, txn_count: 5n },
    ]);
    tx.usageLog.aggregate.mockResolvedValue({ _sum: { costMicros: 250_000_000 } });
    const { service, run } = makeService(tx);

    const report = await service.report(ADMIN, { months: 12 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    // MRR: Plus 3×499 + Premium 2×999 + Premium yearly 1×round(6999/12=583) = 1497 + 1998 + 583.
    expect(report.mrrCents).toBe(1497 + 1998 + 583);
    expect(report.activeSubscriptions).toBe(6);
    // byPlan is highest-tier first (sortOrder desc), each tier's own MRR + active count.
    expect(report.byPlan).toEqual([
      { planKey: "premium", planName: "Premium", activeSubscriptions: 3, mrrCents: 1998 + 583 },
      { planKey: "plus", planName: "Plus", activeSubscriptions: 3, mrrCents: 1497 },
    ]);
    // Series: BigInt coerced, net = gross - refunded.
    expect(report.periods).toEqual([
      { period: "2026-05", grossCents: 1497, refundedCents: 0, netCents: 1497, transactionCount: 3 },
      { period: "2026-06", grossCents: 2496, refundedCents: 499, netCents: 1997, transactionCount: 5 },
    ]);
    // Window totals derived from the series.
    expect(report.grossCents).toBe(1497 + 2496);
    expect(report.refundedCents).toBe(499);
    expect(report.netCents).toBe(1497 + 2496 - 499);
    // Margin: net - round(250_000_000 / 1_000_000) = net - 250 cents.
    expect(report.aiCostMicros).toBe(250_000_000);
    expect(report.marginCents).toBe(report.netCents - 250);
  });

  it("returns zeros for an empty platform (no subs, no ledger, no usage)", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.report(ADMIN, { months: 6 });

    expect(report.mrrCents).toBe(0);
    expect(report.activeSubscriptions).toBe(0);
    expect(report.byPlan).toEqual([]);
    expect(report.periods).toEqual([]);
    expect(report.grossCents).toBe(0);
    expect(report.netCents).toBe(0);
    expect(report.aiCostMicros).toBe(0);
    expect(report.marginCents).toBe(0);
    expect(report.windowMonths).toBe(6);
  });

  it("counts an active subscriber even when its (plan, interval) has no configured price (0 MRR)", async () => {
    const tx = makeTx();
    tx.subscription.groupBy.mockResolvedValue([
      { planId: "plan-plus", interval: "year", _count: { _all: 4 } },
    ]);
    tx.plan.findMany.mockResolvedValue([
      {
        id: "plan-plus",
        key: "plus",
        name: "Plus",
        // Only a monthly price configured — the yearly subscriptions have nothing to price against.
        prices: [{ interval: "month", amountCents: 499 }],
      },
    ]);
    const { service } = makeService(tx);

    const report = await service.report(ADMIN, { months: 12 });

    expect(report.activeSubscriptions).toBe(4);
    expect(report.mrrCents).toBe(0);
    expect(report.byPlan).toEqual([
      { planKey: "plus", planName: "Plus", activeSubscriptions: 4, mrrCents: 0 },
    ]);
  });

  it("reports a negative margin when AI cost exceeds net revenue", async () => {
    const tx = makeTx();
    tx.$queryRawUnsafe.mockResolvedValue([
      { period: "2026-06", gross_cents: 100n, refunded_cents: 0n, txn_count: 1n },
    ]);
    tx.usageLog.aggregate.mockResolvedValue({ _sum: { costMicros: 500_000_000 } }); // 500 cents
    const { service } = makeService(tx);

    const report = await service.report(ADMIN, { months: 1 });

    expect(report.netCents).toBe(100);
    expect(report.marginCents).toBe(100 - 500);
  });

  it("scopes the window consistently across the series and the AI-cost reads", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.report(ADMIN, { months: 1 });

    // The same window start is bound into the period SQL and the usage aggregate.
    const since = tx.$queryRawUnsafe.mock.calls[0][1] as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getUTCDate()).toBe(1); // first day of a month
    expect(report.since).toBe(since.toISOString());
    expect(tx.usageLog.aggregate).toHaveBeenCalledWith({
      _sum: { costMicros: true },
      where: { occurredAt: { gte: since } },
    });
    expect(tx.subscription.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["active", "trialing"] } } }),
    );
  });
});
