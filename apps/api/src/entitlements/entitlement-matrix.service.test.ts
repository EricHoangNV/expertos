import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { EntitlementUpdateInput } from "@expertos/shared";
import { EntitlementMatrixService } from "./entitlement-matrix.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "admin@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

const PLAN_ID = "33333333-3333-3333-3333-333333333333";
const FEATURE_ID = "44444444-4444-4444-4444-444444444444";

function makeTx() {
  return {
    plan: { findMany: jest.fn(), findUnique: jest.fn() },
    feature: { findMany: jest.fn(), findUnique: jest.fn() },
    planEntitlement: { findMany: jest.fn(), upsert: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new EntitlementMatrixService(rls), run };
}

/** A fully-specified metered update body (the schema applies the `null` defaults before this point). */
function meteredInput(over: Partial<EntitlementUpdateInput> = {}): EntitlementUpdateInput {
  return { enabled: true, limit: 200, softLimit: null, window: "month", ...over };
}

describe("EntitlementMatrixService.getMatrix", () => {
  it("maps plans, features, and populated cells under the acting user's RLS context", async () => {
    const tx = makeTx();
    tx.plan.findMany.mockResolvedValue([
      { id: PLAN_ID, key: "free", name: "Free", sortOrder: 0, active: true },
    ]);
    tx.feature.findMany.mockResolvedValue([
      { id: FEATURE_ID, key: "ask_question", name: "Ask a question", type: "metered" },
    ]);
    tx.planEntitlement.findMany.mockResolvedValue([
      {
        planId: PLAN_ID,
        featureId: FEATURE_ID,
        enabled: true,
        limit: 10,
        softLimit: null,
        window: "month",
      },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.getMatrix(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result.plans).toEqual([
      { id: PLAN_ID, key: "free", name: "Free", sortOrder: 0, active: true },
    ]);
    expect(result.features).toEqual([
      { id: FEATURE_ID, key: "ask_question", name: "Ask a question", type: "metered" },
    ]);
    expect(result.cells).toEqual([
      {
        planId: PLAN_ID,
        featureId: FEATURE_ID,
        enabled: true,
        limit: 10,
        softLimit: null,
        window: "month",
      },
    ]);
  });
});

describe("EntitlementMatrixService.updateCell", () => {
  function onExistingPlanFeature(tx: ReturnType<typeof makeTx>, type: "boolean" | "metered") {
    tx.plan.findUnique.mockResolvedValue({ id: PLAN_ID });
    tx.feature.findUnique.mockResolvedValue({ id: FEATURE_ID, type });
  }

  /** Mirror back whatever the service writes, so the test can assert the persisted shape. */
  function echoUpsert(tx: ReturnType<typeof makeTx>) {
    tx.planEntitlement.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({
        planId: create.planId,
        featureId: create.featureId,
        enabled: create.enabled,
        limit: create.limit,
        softLimit: create.softLimit,
        window: create.window,
      }),
    );
  }

  it("forces a boolean feature's metered fields to null even when the body carries them", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "boolean");
    echoUpsert(tx);
    const { service } = makeService(tx);

    const result = await service.updateCell(ADMIN, PLAN_ID, FEATURE_ID, {
      enabled: true,
      limit: 50,
      softLimit: 10,
      window: "day",
    });

    const args = tx.planEntitlement.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ planId_featureId: { planId: PLAN_ID, featureId: FEATURE_ID } });
    expect(args.create).toMatchObject({ enabled: true, limit: null, softLimit: null, window: null });
    expect(args.update).toMatchObject({ enabled: true, limit: null, softLimit: null, window: null });
    expect(result).toEqual({
      planId: PLAN_ID,
      featureId: FEATURE_ID,
      enabled: true,
      limit: null,
      softLimit: null,
      window: null,
    });
  });

  it("keeps a metered feature's quota as submitted", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "metered");
    echoUpsert(tx);
    const { service } = makeService(tx);

    const result = await service.updateCell(
      ADMIN,
      PLAN_ID,
      FEATURE_ID,
      meteredInput({ limit: null, softLimit: 500, window: "month" }),
    );

    expect(result).toEqual({
      planId: PLAN_ID,
      featureId: FEATURE_ID,
      enabled: true,
      limit: null,
      softLimit: 500,
      window: "month",
    });
  });

  it("allows a truly unlimited metered cell (no limit, no soft limit, no window)", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "metered");
    echoUpsert(tx);
    const { service } = makeService(tx);

    const result = await service.updateCell(
      ADMIN,
      PLAN_ID,
      FEATURE_ID,
      meteredInput({ limit: null, softLimit: null, window: null }),
    );

    expect(result.window).toBeNull();
    expect(result.limit).toBeNull();
  });

  it("rejects a soft limit that a hard limit makes unreachable", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "metered");
    const { service } = makeService(tx);

    await expect(
      service.updateCell(ADMIN, PLAN_ID, FEATURE_ID, meteredInput({ limit: 100, softLimit: 100 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.planEntitlement.upsert).not.toHaveBeenCalled();
  });

  it("rejects a metered quota with no window to meter against", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "metered");
    const { service } = makeService(tx);

    await expect(
      service.updateCell(ADMIN, PLAN_ID, FEATURE_ID, meteredInput({ limit: 100, window: null })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.planEntitlement.upsert).not.toHaveBeenCalled();
  });

  it("rejects a soft-limit-only metered cell with no window", async () => {
    const tx = makeTx();
    onExistingPlanFeature(tx, "metered");
    const { service } = makeService(tx);

    await expect(
      service.updateCell(
        ADMIN,
        PLAN_ID,
        FEATURE_ID,
        meteredInput({ limit: null, softLimit: 50, window: null }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s an unknown plan", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.updateCell(ADMIN, PLAN_ID, FEATURE_ID, meteredInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.feature.findUnique).not.toHaveBeenCalled();
  });

  it("404s an unknown feature", async () => {
    const tx = makeTx();
    tx.plan.findUnique.mockResolvedValue({ id: PLAN_ID });
    tx.feature.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.updateCell(ADMIN, PLAN_ID, FEATURE_ID, meteredInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.planEntitlement.upsert).not.toHaveBeenCalled();
  });
});
