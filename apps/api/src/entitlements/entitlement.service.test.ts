import { HttpException, HttpStatus } from "@nestjs/common";
import type { EntitlementDeniedPayload } from "@expertos/shared";
import { EntitlementService } from "./entitlement.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const FREE_PLAN = { id: "plan-free", key: "free", name: "Free", sortOrder: 0 };
const PLUS_PLAN = { id: "plan-plus", key: "plus", name: "Plus", sortOrder: 1 };
const PREMIUM_PLAN = { id: "plan-premium", key: "premium", name: "Premium", sortOrder: 2 };

function makeTx() {
  return {
    subscription: { findFirst: jest.fn() },
    plan: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    planEntitlement: { findMany: jest.fn(), findFirst: jest.fn() },
    usageCounter: { findUnique: jest.fn(), upsert: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new EntitlementService(rls), run };
}

/** Resolves the actor to the Free plan (no live subscription). */
function onFreePlan(tx: ReturnType<typeof makeTx>) {
  tx.subscription.findFirst.mockResolvedValue(null);
  tx.plan.findUnique.mockResolvedValue(FREE_PLAN);
}

describe("EntitlementService.getEntitlements", () => {
  it("returns Free entitlements (boolean + metered with live quota) when there is no subscription", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findMany.mockResolvedValue([
      {
        enabled: true,
        limit: 5,
        window: "month",
        feature: { key: "ask_question", name: "Ask a question", type: "metered" },
      },
      {
        enabled: false,
        limit: null,
        window: null,
        feature: { key: "document_upload", name: "Upload", type: "boolean" },
      },
    ]);
    tx.usageCounter.findUnique.mockResolvedValue({ count: 2 });
    const { service, run } = makeService(tx);

    const result = await service.getEntitlements(USER);

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(result.plan).toEqual({ key: "free", name: "Free" });
    expect(result.features).toEqual([
      {
        key: "ask_question",
        name: "Ask a question",
        type: "metered",
        enabled: true,
        limit: 5,
        window: "month",
        used: 2,
        remaining: 3,
      },
      { key: "document_upload", name: "Upload", type: "boolean", enabled: false },
    ]);
  });

  it("resolves the plan from a live subscription (Free not consulted)", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue({ plan: PLUS_PLAN });
    tx.planEntitlement.findMany.mockResolvedValue([
      {
        enabled: true,
        limit: 100,
        window: "month",
        feature: { key: "ask_question", name: "Ask", type: "metered" },
      },
    ]);
    tx.usageCounter.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    const result = await service.getEntitlements(USER);

    expect(result.plan.key).toBe("plus");
    expect(tx.plan.findUnique).not.toHaveBeenCalled();
    // No counter row yet → used 0, full quota remaining.
    expect(result.features[0]).toMatchObject({ used: 0, remaining: 100 });
    // Subscription lookup is pinned to the actor (admin bypasses RLS).
    expect(tx.subscription.findFirst.mock.calls[0][0].where).toMatchObject({ userId: USER.id });
  });

  it("reports null remaining for an unlimited metered feature", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue({ plan: PREMIUM_PLAN });
    tx.planEntitlement.findMany.mockResolvedValue([
      {
        enabled: true,
        limit: null,
        window: "month",
        feature: { key: "ask_question", name: "Ask", type: "metered" },
      },
    ]);
    tx.usageCounter.findUnique.mockResolvedValue({ count: 7 });
    const { service } = makeService(tx);

    const result = await service.getEntitlements(USER);

    expect(result.features[0]).toMatchObject({ used: 7, remaining: null, limit: null });
  });

  it("treats a metered feature with no window as zero-used without querying a counter", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findMany.mockResolvedValue([
      {
        enabled: true,
        limit: 5,
        window: null,
        feature: { key: "ask_question", name: "Ask", type: "metered" },
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.getEntitlements(USER);

    expect(result.features[0]).toMatchObject({ used: 0, remaining: 5 });
    expect(tx.usageCounter.findUnique).not.toHaveBeenCalled();
  });

  it("throws when the Free plan is not seeded", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.plan.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.getEntitlements(USER)).rejects.toThrow(/Free plan is not seeded/);
  });
});

describe("EntitlementService.enforce", () => {
  it("allows an enabled boolean feature without consuming a counter", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findFirst.mockResolvedValue({
      enabled: true,
      limit: null,
      window: null,
      feature: { type: "boolean" },
    });
    const { service } = makeService(tx);

    await expect(service.enforce(USER, "consultation_booking")).resolves.toBeUndefined();
    expect(tx.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("blocks a disabled boolean feature with a 402 feature_disabled payload + upgrade options", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findFirst.mockResolvedValue({
      enabled: false,
      limit: null,
      window: null,
      feature: { type: "boolean" },
    });
    tx.plan.findMany.mockResolvedValue([{ key: "plus", name: "Plus" }]);
    const { service } = makeService(tx);

    const err = await service.enforce(USER, "document_upload").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect((err as HttpException).getResponse()).toEqual({
      reason: "feature_disabled",
      feature: "document_upload",
      currentPlan: "free",
      upgradeOptions: [{ key: "plus", name: "Plus" }],
      remainingQuota: null,
    } satisfies EntitlementDeniedPayload);
  });

  it("blocks an unknown feature (no entitlement row) as a closed gate", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const err = await service.enforce(USER, "ask_question").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(tx.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("allows an unlimited metered feature without consuming a counter", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue({ plan: PREMIUM_PLAN });
    tx.planEntitlement.findFirst.mockResolvedValue({
      enabled: true,
      limit: null,
      window: "month",
      feature: { type: "metered" },
    });
    const { service } = makeService(tx);

    await expect(service.enforce(USER, "ask_question")).resolves.toBeUndefined();
    expect(tx.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("allows a misconfigured metered feature (no window) without consuming a counter", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findFirst.mockResolvedValue({
      enabled: true,
      limit: 5,
      window: null,
      feature: { type: "metered" },
    });
    const { service } = makeService(tx);

    await expect(service.enforce(USER, "ask_question")).resolves.toBeUndefined();
    expect(tx.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("consumes one unit and allows a metered feature under its cap", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-03T15:30:00.000Z"));
    try {
      const tx = makeTx();
      onFreePlan(tx);
      tx.planEntitlement.findFirst.mockResolvedValue({
        enabled: true,
        limit: 5,
        window: "month",
        feature: { type: "metered" },
      });
      tx.usageCounter.upsert.mockResolvedValue({ count: 3 });
      const { service } = makeService(tx);

      await expect(service.enforce(USER, "ask_question")).resolves.toBeUndefined();

      const arg = tx.usageCounter.upsert.mock.calls[0][0];
      expect(arg.where.userId_featureKey_window_windowStart).toEqual({
        userId: USER.id,
        featureKey: "ask_question",
        window: "month",
        windowStart: new Date("2026-06-01T00:00:00.000Z"),
      });
      expect(arg.create).toMatchObject({ tenantId: USER.tenantId, userId: USER.id, count: 1 });
      expect(arg.update).toEqual({ count: { increment: 1 } });
    } finally {
      jest.useRealTimers();
    }
  });

  it("blocks a metered feature at its cap with a 402 quota_exceeded payload (increment rolled back by the throw)", async () => {
    const tx = makeTx();
    onFreePlan(tx);
    tx.planEntitlement.findFirst.mockResolvedValue({
      enabled: true,
      limit: 5,
      window: "month",
      feature: { type: "metered" },
    });
    tx.usageCounter.upsert.mockResolvedValue({ count: 6 });
    tx.plan.findMany.mockResolvedValue([{ key: "premium", name: "Premium" }]);
    const { service } = makeService(tx);

    const err = await service.enforce(USER, "ask_question").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect((err as HttpException).getResponse()).toMatchObject({
      reason: "quota_exceeded",
      feature: "ask_question",
      currentPlan: "free",
      upgradeOptions: [{ key: "premium", name: "Premium" }],
      remainingQuota: 0,
    });
    // The quota upsell only offers tiers that raise the cap (unlimited or a larger limit).
    const where = tx.plan.findMany.mock.calls[0][0].where;
    expect(where.entitlements.some.OR).toEqual([{ limit: null }, { limit: { gt: 5 } }]);
  });

  it("keys the day window on UTC midnight", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-03T15:30:00.000Z"));
    try {
      const tx = makeTx();
      onFreePlan(tx);
      tx.planEntitlement.findFirst.mockResolvedValue({
        enabled: true,
        limit: 10,
        window: "day",
        feature: { type: "metered" },
      });
      tx.usageCounter.upsert.mockResolvedValue({ count: 1 });
      const { service } = makeService(tx);

      await service.enforce(USER, "ask_question");

      expect(
        tx.usageCounter.upsert.mock.calls[0][0].where.userId_featureKey_window_windowStart
          .windowStart,
      ).toEqual(new Date("2026-06-03T00:00:00.000Z"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("keys the week window on the preceding Monday at UTC midnight", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-03T15:30:00.000Z"));
    try {
      const tx = makeTx();
      onFreePlan(tx);
      tx.planEntitlement.findFirst.mockResolvedValue({
        enabled: true,
        limit: 10,
        window: "week",
        feature: { type: "metered" },
      });
      tx.usageCounter.upsert.mockResolvedValue({ count: 1 });
      const { service } = makeService(tx);

      await service.enforce(USER, "ask_question");

      const start: Date =
        tx.usageCounter.upsert.mock.calls[0][0].where.userId_featureKey_window_windowStart
          .windowStart;
      // 2026-06-03 is a Wednesday → window starts Monday 2026-06-01.
      expect(start).toEqual(new Date("2026-06-01T00:00:00.000Z"));
      expect(start.getUTCDay()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
