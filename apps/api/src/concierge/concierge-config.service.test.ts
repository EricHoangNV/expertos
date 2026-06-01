import { BadRequestException } from "@nestjs/common";
import type { ReviewConfigUpdateInput } from "@expertos/shared";
import { ConciergeConfigService } from "./concierge-config.service";
import type { RlsService } from "../auth/rls.service";
import type { AdminAuditService } from "../admin/admin-audit.service";
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

const UPDATED_AT = new Date("2026-06-01T12:00:00.000Z");

function makeTx() {
  return {
    reviewConfig: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>, silentAllowed: boolean) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  return { service: new ConciergeConfigService(rls, audit, silentAllowed), run, record };
}

/** A fully-specified update body (the schema applies coercion/defaults before this point). */
function input(over: Partial<ReviewConfigUpdateInput> = {}): ReviewConfigUpdateInput {
  return {
    enabled: true,
    triggerMode: "user_prompted",
    confidenceThreshold: 0.5,
    slaHours: 24,
    volumeCapPerDay: 50,
    ...over,
  };
}

/** Mirror back whatever the service writes (`update`/`create`), so the persisted shape is assertable. */
function echoWrite(tx: ReturnType<typeof makeTx>, id: string) {
  const impl = ({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id,
      enabled: data.enabled,
      triggerMode: data.triggerMode,
      confidenceThreshold: data.confidenceThreshold,
      slaHours: data.slaHours,
      volumeCapPerDay: data.volumeCapPerDay,
      updatedAt: UPDATED_AT,
    });
  tx.reviewConfig.update.mockImplementation(impl);
  tx.reviewConfig.create.mockImplementation(impl);
}

describe("ConciergeConfigService.getConfig", () => {
  it("maps the singleton row to a DTO (stamping silentReviewAllowed) under the actor's RLS", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({
      id: "cfg-1",
      enabled: true,
      triggerMode: "user_prompted",
      confidenceThreshold: 0.4,
      slaHours: 12,
      volumeCapPerDay: 25,
      updatedAt: UPDATED_AT,
    });
    const { service, run } = makeService(tx, true);

    const result = await service.getConfig(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result).toEqual({
      enabled: true,
      triggerMode: "user_prompted",
      confidenceThreshold: 0.4,
      slaHours: 12,
      volumeCapPerDay: 25,
      silentReviewAllowed: true,
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it("returns launch defaults (Off, null updatedAt) when the config has never been seeded", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx, false);

    const result = await service.getConfig(ADMIN);

    expect(result).toEqual({
      enabled: false,
      triggerMode: "user_prompted",
      confidenceThreshold: 0.5,
      slaHours: 24,
      volumeCapPerDay: 50,
      silentReviewAllowed: false,
      updatedAt: null,
    });
  });
});

describe("ConciergeConfigService.updateConfig", () => {
  it("updates the existing singleton row and records an audit entry in the same tx", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({ id: "cfg-1" });
    echoWrite(tx, "cfg-1");
    const { service, record } = makeService(tx, true);

    const result = await service.updateConfig(ADMIN, input({ slaHours: 8, volumeCapPerDay: 5 }));

    expect(tx.reviewConfig.update.mock.calls[0][0]).toMatchObject({ where: { id: "cfg-1" } });
    expect(tx.reviewConfig.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enabled: true, slaHours: 8, volumeCapPerDay: 5 });
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({ action: "concierge.config_updated", targetType: "review_config", targetId: "cfg-1" }),
    );
  });

  it("creates the row when the DB was never seeded (no existing singleton)", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue(null);
    echoWrite(tx, "cfg-new");
    const { service, record } = makeService(tx, true);

    const result = await service.updateConfig(ADMIN, input());

    expect(tx.reviewConfig.create).toHaveBeenCalledTimes(1);
    expect(tx.reviewConfig.update).not.toHaveBeenCalled();
    expect(result.enabled).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("rejects enabling Mode B (auto_silent) when silent review is not allowed — no write, no audit", async () => {
    const tx = makeTx();
    const { service, record } = makeService(tx, false);

    await expect(
      service.updateConfig(ADMIN, input({ enabled: true, triggerMode: "auto_silent" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.reviewConfig.update).not.toHaveBeenCalled();
    expect(tx.reviewConfig.create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("allows enabling Mode B when silent review is allowed", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({ id: "cfg-1" });
    echoWrite(tx, "cfg-1");
    const { service } = makeService(tx, true);

    const result = await service.updateConfig(
      ADMIN,
      input({ enabled: true, triggerMode: "auto_silent" }),
    );

    expect(result).toMatchObject({ triggerMode: "auto_silent", silentReviewAllowed: true });
  });

  it("permits auto_silent when disabled even if silent review is not allowed (the gate is enabled+Mode B)", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({ id: "cfg-1" });
    echoWrite(tx, "cfg-1");
    const { service } = makeService(tx, false);

    const result = await service.updateConfig(
      ADMIN,
      input({ enabled: false, triggerMode: "auto_silent" }),
    );

    expect(result).toMatchObject({ enabled: false, triggerMode: "auto_silent", silentReviewAllowed: false });
    expect(tx.reviewConfig.update).toHaveBeenCalledTimes(1);
  });
});
