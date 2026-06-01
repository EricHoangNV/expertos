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
    user: { count: jest.fn().mockResolvedValue(0) },
    conversation: { count: jest.fn().mockResolvedValue(0) },
    consultationRecommendation: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    consultation: { groupBy: jest.fn().mockResolvedValue([]) },
    humanReviewRequest: { groupBy: jest.fn().mockResolvedValue([]) },
    reviewResponse: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    chunk: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { flagCount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
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

describe("AnalyticsService.concierge", () => {
  it("combines volume, SLA, verdicts, and knowledge-quality signals", async () => {
    const tx = makeTx();
    // Volume: one groupBy folded into status / trigger-mode / visibility.
    tx.humanReviewRequest.groupBy.mockResolvedValue([
      { status: "answered", triggerMode: "auto_silent", visibility: "silent", _count: { _all: 6 } },
      { status: "requested", triggerMode: "auto_silent", visibility: "silent", _count: { _all: 2 } },
      {
        status: "answered",
        triggerMode: "user_prompted",
        visibility: "visible",
        _count: { _all: 3 },
      },
      {
        status: "escalated",
        triggerMode: "user_prompted",
        visibility: "visible",
        _count: { _all: 1 },
      },
    ]);
    // SLA: FILTERed counts (bigint) + average response seconds (numeric string).
    tx.$queryRawUnsafe.mockResolvedValue([
      { tracked: 12n, met: 8n, breached: 1n, open_overdue: 2n, avg_response_seconds: "5400" },
    ]);
    // Verdicts: grouped + windowed edited/delivered.
    tx.reviewResponse.groupBy.mockResolvedValue([
      { verdict: "good", _count: { _all: 5 } },
      { verdict: "great", _count: { _all: 3 } },
      { verdict: "bad", _count: { _all: 1 } },
    ]);
    tx.reviewResponse.count.mockResolvedValueOnce(4).mockResolvedValueOnce(4); // edited, delivered
    // Knowledge quality: flagged-chunk count, total flags, recently flagged, top list.
    tx.chunk.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2); // flaggedChunks, recentlyFlagged
    tx.chunk.aggregate.mockResolvedValue({ _sum: { flagCount: 7 } });
    tx.chunk.findMany.mockResolvedValue([
      {
        id: "c1",
        documentVersionId: "dv1",
        flagCount: 4,
        lastFlaggedAt: new Date("2026-05-30T10:00:00Z"),
        summary: "  A weak\n  paragraph   summary  ",
        content: "full content",
      },
      {
        id: "c2",
        documentVersionId: "dv2",
        flagCount: 3,
        lastFlaggedAt: null,
        summary: null,
        content: "fallback content when summary is null",
      },
    ]);
    const { service, run } = makeService(tx);

    const report = await service.concierge(ADMIN, { days: 30 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(report.windowDays).toBe(30);
    expect(report.totalRequests).toBe(12);
    expect(report.byStatus).toEqual({
      requested: 2,
      in_review: 0,
      answered: 9,
      escalated: 1,
      dismissed: 0,
    });
    expect(report.byTriggerMode).toEqual({ user_prompted: 4, auto_silent: 8 });
    expect(report.byVisibility).toEqual({ visible: 4, silent: 8 });
    // SLA: bigints coerced; 5400s → 90 minutes.
    expect(report.sla).toEqual({
      tracked: 12,
      met: 8,
      breached: 1,
      openOverdue: 2,
      avgResponseMinutes: 90,
    });
    // Verdicts: every key present, plus windowed edited/delivered.
    expect(report.verdicts).toEqual({
      total: 9,
      byVerdict: { good: 5, bad: 1, great: 3 },
      edited: 4,
      delivered: 4,
    });
    // Knowledge quality: cumulative counts + collapsed-whitespace excerpts (summary, then content).
    expect(report.knowledge.flaggedChunks).toBe(3);
    expect(report.knowledge.totalFlags).toBe(7);
    expect(report.knowledge.recentlyFlagged).toBe(2);
    expect(report.knowledge.topFlagged).toEqual([
      {
        chunkId: "c1",
        documentVersionId: "dv1",
        flagCount: 4,
        lastFlaggedAt: "2026-05-30T10:00:00.000Z",
        excerpt: "A weak paragraph summary",
      },
      {
        chunkId: "c2",
        documentVersionId: "dv2",
        flagCount: 3,
        lastFlaggedAt: null,
        excerpt: "fallback content when summary is null",
      },
    ]);
  });

  it("returns zeros/empties for an idle concierge with no requests, verdicts, or flags", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.concierge(ADMIN, { days: 7 });

    expect(report.windowDays).toBe(7);
    expect(report.totalRequests).toBe(0);
    expect(report.byStatus).toEqual({
      requested: 0,
      in_review: 0,
      answered: 0,
      escalated: 0,
      dismissed: 0,
    });
    expect(report.byTriggerMode).toEqual({ user_prompted: 0, auto_silent: 0 });
    expect(report.byVisibility).toEqual({ visible: 0, silent: 0 });
    // Empty SLA aggregate row → all zero, no average.
    expect(report.sla).toEqual({
      tracked: 0,
      met: 0,
      breached: 0,
      openOverdue: 0,
      avgResponseMinutes: null,
    });
    expect(report.verdicts).toEqual({
      total: 0,
      byVerdict: { good: 0, bad: 0, great: 0 },
      edited: 0,
      delivered: 0,
    });
    expect(report.knowledge).toEqual({
      flaggedChunks: 0,
      totalFlags: 0,
      recentlyFlagged: 0,
      topFlagged: [],
    });
  });

  it("truncates a long excerpt and binds the window into every read", async () => {
    const tx = makeTx();
    const long = "x".repeat(400);
    tx.chunk.count.mockResolvedValue(1);
    tx.chunk.findMany.mockResolvedValue([
      {
        id: "c1",
        documentVersionId: "dv1",
        flagCount: 2,
        lastFlaggedAt: null,
        summary: long,
        content: "ignored",
      },
    ]);
    const { service } = makeService(tx);

    const report = await service.concierge(ADMIN, { days: 1 });

    // days = 1 → start of today (UTC midnight).
    const since = tx.humanReviewRequest.groupBy.mock.calls[0][0].where.createdAt.gte as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getUTCHours()).toBe(0);
    expect(report.since).toBe(since.toISOString());
    // Excerpt capped at 160 chars + ellipsis.
    const excerpt = report.knowledge.topFlagged[0].excerpt;
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBe(161);
    // The SLA raw read binds the window start ($1) and a now cutoff ($2).
    expect(tx.$queryRawUnsafe.mock.calls[0][1]).toBe(since);
    expect(tx.$queryRawUnsafe.mock.calls[0][2]).toBeInstanceOf(Date);
    // Verdict + recently-flagged reads bound by the window.
    expect(tx.reviewResponse.groupBy.mock.calls[0][0].where).toEqual({ createdAt: { gte: since } });
    const recentCall = tx.chunk.count.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { lastFlaggedAt?: unknown } }).where.lastFlaggedAt != null,
    );
    expect(recentCall?.[0].where).toEqual({ lastFlaggedAt: { gte: since } });
  });
});

describe("AnalyticsService.validation", () => {
  it("folds activation, engagement, willingness-to-pay, and funnel into one scorecard", async () => {
    const tx = makeTx();
    // Raw reads, in order: cohort, engagement, wtp, funnel-revenue.
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ new_users: 20n, activated: 12n, returned: 8n }])
      .mockResolvedValueOnce([
        { active_users: 16n, total_questions: 64n, median_questions: "3.5" },
      ])
      .mockResolvedValueOnce([{ paying: 5n, trialing: 2n }])
      .mockResolvedValueOnce([{ bookings: 4n, revenue: 60000n, booking_users: 3n }]);
    tx.user.count.mockResolvedValue(50); // total users (cumulative)
    tx.consultationRecommendation.count.mockResolvedValue(10);
    const { service, run } = makeService(tx);

    const report = await service.validation(ADMIN, { days: 30 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(report.windowDays).toBe(30);
    // Activation: 12/20 = 0.6.
    expect(report.activation).toEqual({
      newUsers: 20,
      activatedUsers: 12,
      activationRate: 0.6,
    });
    // Engagement: bigints coerced, median from numeric string, 8/20 = 0.4 return.
    expect(report.engagement).toEqual({
      activeUsers: 16,
      totalQuestions: 64,
      medianQuestionsPerActiveUser: 3.5,
      returnedUsers: 8,
      returnRate: 0.4,
    });
    // Willingness to pay (cumulative): 5/50 = 0.1.
    expect(report.willingnessToPay).toEqual({
      totalUsers: 50,
      payingUsers: 5,
      trialingUsers: 2,
      freeToPaidRate: 0.1,
    });
    // Funnel: 4/10 = 0.4 conversion; 60000 / 3 buyers = 20000 cents each.
    expect(report.funnel).toEqual({
      recommendations: 10,
      bookings: 4,
      recommendationToBookingRate: 0.4,
      bookedRevenueCents: 60000,
      bookingUsers: 3,
      revenuePerBookingUserCents: 20000,
    });
  });

  it("returns zeros (no NaN) for an empty platform", async () => {
    const tx = makeTx();
    // All raw reads come back empty; user.count + recommendation.count default to 0.
    const { service } = makeService(tx);

    const report = await service.validation(ADMIN, { days: 7 });

    expect(report.windowDays).toBe(7);
    expect(report.activation).toEqual({ newUsers: 0, activatedUsers: 0, activationRate: 0 });
    expect(report.engagement).toEqual({
      activeUsers: 0,
      totalQuestions: 0,
      medianQuestionsPerActiveUser: 0,
      returnedUsers: 0,
      returnRate: 0,
    });
    expect(report.willingnessToPay).toEqual({
      totalUsers: 0,
      payingUsers: 0,
      trialingUsers: 0,
      freeToPaidRate: 0,
    });
    expect(report.funnel).toEqual({
      recommendations: 0,
      bookings: 0,
      recommendationToBookingRate: 0,
      bookedRevenueCents: 0,
      bookingUsers: 0,
      revenuePerBookingUserCents: 0,
    });
  });

  it("coerces a null median (active CTE empty) to 0 and rounds rates to 4 decimals", async () => {
    const tx = makeTx();
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ new_users: 3n, activated: 1n, returned: 0n }])
      // active_users 0 → percentile_cont returns null.
      .mockResolvedValueOnce([{ active_users: 0n, total_questions: 0n, median_questions: null }])
      .mockResolvedValueOnce([{ paying: 1n, trialing: 0n }])
      .mockResolvedValueOnce([{ bookings: 0n, revenue: 0n, booking_users: 0n }]);
    tx.user.count.mockResolvedValue(7);
    tx.consultationRecommendation.count.mockResolvedValue(0);
    const { service } = makeService(tx);

    const report = await service.validation(ADMIN, { days: 30 });

    expect(report.engagement.medianQuestionsPerActiveUser).toBe(0);
    // 1/3 → 0.3333 (rounded to 4 dp).
    expect(report.activation.activationRate).toBe(0.3333);
    // 1/7 → 0.1429.
    expect(report.willingnessToPay.freeToPaidRate).toBe(0.1429);
    // No recommendations → conversion 0 (not NaN); no buyers → revenue/user 0.
    expect(report.funnel.recommendationToBookingRate).toBe(0);
    expect(report.funnel.revenuePerBookingUserCents).toBe(0);
  });

  it("binds the window start into the cohort/engagement/funnel reads but not the cumulative WTP read", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const report = await service.validation(ADMIN, { days: 1 });

    // days = 1 → start of today (UTC midnight).
    const since = tx.$queryRawUnsafe.mock.calls[0][1] as Date;
    expect(since).toBeInstanceOf(Date);
    expect(since.getUTCHours()).toBe(0);
    expect(report.since).toBe(since.toISOString());
    // Cohort ($1), engagement ($1), and funnel-revenue ($1) all bind the window start.
    expect(tx.$queryRawUnsafe.mock.calls[0][1]).toBe(since); // cohort
    expect(tx.$queryRawUnsafe.mock.calls[1][1]).toBe(since); // engagement
    expect(tx.$queryRawUnsafe.mock.calls[3][1]).toBe(since); // funnel revenue
    // WTP is cumulative — the raw read takes no window arg.
    expect(tx.$queryRawUnsafe.mock.calls[2]).toHaveLength(1);
    // Recommendations are windowed via Prisma.
    expect(tx.consultationRecommendation.count.mock.calls[0][0].where).toEqual({
      createdAt: { gte: since },
    });
  });
});
