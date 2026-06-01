import { AnalyticsService } from "./analytics.service";
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
    usageLog: { groupBy: jest.fn().mockResolvedValue([]) },
    conversation: { count: jest.fn().mockResolvedValue(0) },
    consultationRecommendation: { groupBy: jest.fn().mockResolvedValue([]) },
    consultation: { groupBy: jest.fn().mockResolvedValue([]) },
    // dailySeries reads first, then activeUsers — sequence with mockResolvedValueOnce in tests.
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new AnalyticsService(rls), run };
}

describe("AnalyticsService.usage", () => {
  it("combines per-feature/per-model rollups, the daily series, and window active users", async () => {
    const tx = makeTx();
    // byFeature, then byModel (two groupBy calls in order).
    tx.usageLog.groupBy
      .mockResolvedValueOnce([
        {
          featureKey: "chat.answer",
          _count: { _all: 4 },
          _sum: { promptTokens: 12000, completionTokens: 2400, costMicros: 7200 },
        },
        {
          featureKey: "retrieve.embed",
          _count: { _all: 8 },
          _sum: { promptTokens: 160, completionTokens: 0, costMicros: 32 },
        },
      ])
      .mockResolvedValueOnce([
        {
          model: "echo-dev",
          _count: { _all: 4 },
          _sum: { promptTokens: 12000, completionTokens: 2400, costMicros: 7200 },
        },
        {
          model: null, // a cache/marker row — surfaces as "(none)"
          _count: { _all: 8 },
          _sum: { promptTokens: 160, completionTokens: 0, costMicros: 32 },
        },
      ]);
    // dailySeries (BigInt from Postgres), then the active-users scalar.
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([
        { period: "2026-05-31", events: 5n, cost_micros: 3200n, active_users: 2n },
        { period: "2026-06-01", events: 7n, cost_micros: 4032n, active_users: 3n },
      ])
      .mockResolvedValueOnce([{ active_users: 4n }]);
    const { service, run } = makeService(tx);

    const report = await service.usage(ADMIN, { days: 30 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    // byFeature: highest spend first.
    expect(report.byFeature).toEqual([
      {
        featureKey: "chat.answer",
        events: 4,
        promptTokens: 12000,
        completionTokens: 2400,
        costMicros: 7200,
      },
      {
        featureKey: "retrieve.embed",
        events: 8,
        promptTokens: 160,
        completionTokens: 0,
        costMicros: 32,
      },
    ]);
    // byModel: null model relabeled "(none)", highest spend first.
    expect(report.byModel).toEqual([
      {
        model: "echo-dev",
        events: 4,
        promptTokens: 12000,
        completionTokens: 2400,
        costMicros: 7200,
      },
      { model: "(none)", events: 8, promptTokens: 160, completionTokens: 0, costMicros: 32 },
    ]);
    // Totals derived by summing the by-feature rollup.
    expect(report.totalEvents).toBe(12);
    expect(report.promptTokens).toBe(12160);
    expect(report.completionTokens).toBe(2400);
    expect(report.totalCostMicros).toBe(7232);
    // Daily series: BigInt coerced.
    expect(report.periods).toEqual([
      { period: "2026-05-31", events: 5, costMicros: 3200, activeUsers: 2 },
      { period: "2026-06-01", events: 7, costMicros: 4032, activeUsers: 3 },
    ]);
    // Window active users is the distinct scalar (4), NOT the per-day sum (5).
    expect(report.activeUsers).toBe(4);
    expect(report.windowDays).toBe(30);
  });

  it("returns zeros for an empty platform (no usage anywhere)", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.usage(ADMIN, { days: 7 });

    expect(report.byFeature).toEqual([]);
    expect(report.byModel).toEqual([]);
    expect(report.periods).toEqual([]);
    expect(report.totalEvents).toBe(0);
    expect(report.promptTokens).toBe(0);
    expect(report.completionTokens).toBe(0);
    expect(report.totalCostMicros).toBe(0);
    expect(report.activeUsers).toBe(0);
    expect(report.windowDays).toBe(7);
  });

  it("coalesces null token/cost sums to 0 (a feature logged with no model/tokens)", async () => {
    const tx = makeTx();
    tx.usageLog.groupBy
      .mockResolvedValueOnce([
        {
          featureKey: "cache.hit",
          _count: { _all: 3 },
          _sum: { promptTokens: null, completionTokens: null, costMicros: null },
        },
      ])
      .mockResolvedValueOnce([]);
    const { service } = makeService(tx);

    const report = await service.usage(ADMIN, { days: 30 });

    expect(report.byFeature).toEqual([
      { featureKey: "cache.hit", events: 3, promptTokens: 0, completionTokens: 0, costMicros: 0 },
    ]);
    expect(report.totalEvents).toBe(3);
    expect(report.totalCostMicros).toBe(0);
  });

  it("binds the same window start into both groupBy reads and both raw reads", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.usage(ADMIN, { days: 1 });

    // days = 1 → start of today (UTC midnight).
    const since = tx.$queryRawUnsafe.mock.calls[0][1] as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getUTCHours()).toBe(0);
    expect(since.getUTCMinutes()).toBe(0);
    expect(report.since).toBe(since.toISOString());
    // Both groupBy reads bound by the window.
    for (const call of tx.usageLog.groupBy.mock.calls) {
      expect(call[0].where).toEqual({ occurredAt: { gte: since } });
    }
    // Both raw reads bound by the same window start.
    expect(tx.$queryRawUnsafe.mock.calls[0][1]).toBe(since);
    expect(tx.$queryRawUnsafe.mock.calls[1][1]).toBe(since);
  });

  it("handles an empty active-users scalar result without throwing", async () => {
    const tx = makeTx();
    tx.usageLog.groupBy.mockResolvedValue([]);
    // dailySeries returns rows but the active-users scalar comes back empty.
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ period: "2026-06-01", events: 1n, cost_micros: 0n, active_users: 0n }])
      .mockResolvedValueOnce([]);
    const { service } = makeService(tx);

    const report = await service.usage(ADMIN, { days: 30 });

    expect(report.activeUsers).toBe(0);
    expect(report.periods).toHaveLength(1);
  });
});

describe("AnalyticsService.funnel", () => {
  it("combines the conversation, recommendation, consultation, and revenue stages", async () => {
    const tx = makeTx();
    tx.conversation.count.mockResolvedValue(40);
    // Recommendations grouped by (trigger, response).
    tx.consultationRecommendation.groupBy.mockResolvedValue([
      { trigger: "topic", response: "book", _count: { _all: 5 } },
      { trigger: "topic", response: "maybe_later", _count: { _all: 3 } },
      { trigger: "depth", response: "pending", _count: { _all: 2 } },
      { trigger: "high_intent", response: "ask_another", _count: { _all: 1 } },
    ]);
    // Funnel-attributed consultations grouped by status (with summed amounts).
    tx.consultation.groupBy.mockResolvedValue([
      { status: "booked", _count: { _all: 4 }, _sum: { amountCents: 40000 } },
      { status: "completed", _count: { _all: 1 }, _sum: { amountCents: 15000 } },
      { status: "canceled", _count: { _all: 1 }, _sum: { amountCents: null } },
    ]);
    const { service, run } = makeService(tx);

    const report = await service.funnel(ADMIN, { days: 30 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(report.windowDays).toBe(30);
    expect(report.conversations).toBe(40);
    // Recommendations: total + breakdowns (every key present, zero where unseen).
    expect(report.recommendations).toBe(11);
    expect(report.byTrigger).toEqual({ topic: 8, depth: 2, low_confidence: 0, high_intent: 1 });
    expect(report.byResponse).toEqual({ pending: 2, book: 5, maybe_later: 3, ask_another: 1 });
    // Consultations: total + status breakdown; revenue only from booked/confirmed/completed.
    expect(report.consultations).toBe(6);
    expect(report.byConsultationStatus).toEqual({
      recommended: 0,
      booked: 4,
      confirmed: 0,
      completed: 1,
      canceled: 1,
      no_show: 0,
    });
    // 40000 (booked) + 15000 (completed); the canceled row's null amount is ignored.
    expect(report.bookedRevenueCents).toBe(55000);
  });

  it("returns zeros for an empty platform (no funnel activity)", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.funnel(ADMIN, { days: 7 });

    expect(report.windowDays).toBe(7);
    expect(report.conversations).toBe(0);
    expect(report.recommendations).toBe(0);
    expect(report.byTrigger).toEqual({ topic: 0, depth: 0, low_confidence: 0, high_intent: 0 });
    expect(report.byResponse).toEqual({ pending: 0, book: 0, maybe_later: 0, ask_another: 0 });
    expect(report.consultations).toBe(0);
    expect(report.byConsultationStatus).toEqual({
      recommended: 0,
      booked: 0,
      confirmed: 0,
      completed: 0,
      canceled: 0,
      no_show: 0,
    });
    expect(report.bookedRevenueCents).toBe(0);
  });

  it("scopes the consultation stage to funnel-attributed rows and bounds every read by the window", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.funnel(ADMIN, { days: 1 });

    // days = 1 → start of today (UTC midnight).
    const since = tx.conversation.count.mock.calls[0][0].where.createdAt.gte as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getUTCHours()).toBe(0);
    expect(report.since).toBe(since.toISOString());
    // Recommendations bound by the window.
    expect(tx.consultationRecommendation.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: since },
    });
    // Consultations: windowed AND restricted to those with a recommendation (funnel attribution).
    expect(tx.consultation.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: since },
      recommendations: { some: {} },
    });
  });
});
