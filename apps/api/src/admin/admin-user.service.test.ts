import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminUserService } from "./admin-user.service";
import type { AdminAuditService } from "./admin-audit.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
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

const USER_ID = "99999999-9999-9999-9999-999999999999";
const FLAG_ID = "88888888-8888-8888-8888-888888888888";

function makeTx() {
  return {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    fairUseFlag: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    dataDeletionRequest: { create: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  return { service: new AdminUserService(rls, audit, logger), run, record, info };
}

describe("AdminUserService.list", () => {
  it("maps users, deriving plan/status from the most-recent subscription (or null)", async () => {
    const tx = makeTx();
    const created = new Date("2026-01-01T00:00:00.000Z");
    tx.user.findMany.mockResolvedValue([
      {
        id: USER_ID,
        email: "a@x.io",
        displayName: "A",
        role: "user",
        createdAt: created,
        subscriptions: [{ status: "active", plan: { key: "premium" } }],
      },
      {
        id: "u2",
        email: "b@x.io",
        displayName: null,
        role: "expert",
        createdAt: created,
        subscriptions: [],
      },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 50, skip: 0 }),
    );
    expect(result).toEqual([
      {
        id: USER_ID,
        email: "a@x.io",
        displayName: "A",
        role: "user",
        planKey: "premium",
        subscriptionStatus: "active",
        createdAt: created.toISOString(),
      },
      {
        id: "u2",
        email: "b@x.io",
        displayName: null,
        role: "expert",
        planKey: null,
        subscriptionStatus: null,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("builds a role + case-insensitive email/name search filter", async () => {
    const tx = makeTx();
    tx.user.findMany.mockResolvedValue([]);
    const { service } = makeService(tx);

    await service.list(ADMIN, { limit: 25, offset: 10, role: "expert", search: "ali" });

    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "expert",
          OR: [
            { email: { contains: "ali", mode: "insensitive" } },
            { displayName: { contains: "ali", mode: "insensitive" } },
          ],
        },
        take: 25,
        skip: 10,
      }),
    );
  });
});

describe("AdminUserService.get", () => {
  it("maps a full detail (subscription with dates, flags, deletion, activity counts)", async () => {
    const tx = makeTx();
    const d = new Date("2026-02-02T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "a@x.io",
      displayName: "A",
      role: "user",
      locale: "en",
      createdAt: d,
      updatedAt: d,
      subscriptions: [
        {
          id: "s1",
          interval: "month",
          status: "active",
          currentPeriodEnd: d,
          cancelAt: d,
          plan: { key: "premium", name: "Premium" },
        },
      ],
      fairUseFlags: [{ id: FLAG_ID, reason: "spike", status: "open", createdAt: d }],
      dataDeletionRequests: [
        { id: "dr1", userId: USER_ID, status: "completed", requestedAt: d, completedAt: d },
      ],
      _count: { conversations: 3, uploadedFiles: 2, consultations: 1 },
    });
    const { service } = makeService(tx);

    const result = await service.get(ADMIN, USER_ID);

    expect(result.subscription).toEqual({
      id: "s1",
      planKey: "premium",
      planName: "Premium",
      interval: "month",
      status: "active",
      currentPeriodEnd: d.toISOString(),
      cancelAt: d.toISOString(),
    });
    expect(result.activity).toEqual({
      conversationCount: 3,
      uploadCount: 2,
      consultationCount: 1,
    });
    expect(result.fairUseFlags).toEqual([
      { id: FLAG_ID, reason: "spike", status: "open", createdAt: d.toISOString() },
    ]);
    expect(result.deletion).toEqual({
      id: "dr1",
      userId: USER_ID,
      status: "completed",
      requestedAt: d.toISOString(),
      completedAt: d.toISOString(),
    });
  });

  it("maps a subscription with null period/cancel dates", async () => {
    const tx = makeTx();
    const d = new Date("2026-02-02T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "a@x.io",
      displayName: null,
      role: "user",
      locale: "en",
      createdAt: d,
      updatedAt: d,
      subscriptions: [
        {
          id: "s1",
          interval: "month",
          status: "trialing",
          currentPeriodEnd: null,
          cancelAt: null,
          plan: { key: "plus", name: "Plus" },
        },
      ],
      fairUseFlags: [],
      dataDeletionRequests: [],
      _count: { conversations: 0, uploadedFiles: 0, consultations: 0 },
    });
    const { service } = makeService(tx);

    const result = await service.get(ADMIN, USER_ID);

    expect(result.subscription).toMatchObject({ currentPeriodEnd: null, cancelAt: null });
    expect(result.deletion).toBeNull();
    expect(result.fairUseFlags).toEqual([]);
  });

  it("maps a user with no subscription as null", async () => {
    const tx = makeTx();
    const d = new Date("2026-02-02T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "a@x.io",
      displayName: null,
      role: "user",
      locale: "vi",
      createdAt: d,
      updatedAt: d,
      subscriptions: [],
      fairUseFlags: [],
      dataDeletionRequests: [],
      _count: { conversations: 0, uploadedFiles: 0, consultations: 0 },
    });
    const { service } = makeService(tx);

    const result = await service.get(ADMIN, USER_ID);

    expect(result.subscription).toBeNull();
    expect(result.locale).toBe("vi");
  });

  it("404s an unknown user", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.get(ADMIN, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminUserService.updateRole", () => {
  it("rejects changing your own role before touching the DB", async () => {
    const tx = makeTx();
    const { service, run } = makeService(tx);

    await expect(
      service.updateRole(ADMIN, ADMIN.id, { role: "user" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it("404s an unknown user", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.updateRole(ADMIN, USER_ID, { role: "expert" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("updates the role and records a from→to audit entry", async () => {
    const tx = makeTx();
    const created = new Date("2026-01-01T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({ role: "user" });
    tx.user.update.mockResolvedValue({
      id: USER_ID,
      email: "a@x.io",
      displayName: "A",
      role: "expert",
      createdAt: created,
      subscriptions: [],
    });
    const { service, record } = makeService(tx);

    const result = await service.updateRole(ADMIN, USER_ID, { role: "expert" });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID }, data: { role: "expert" } }),
    );
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "user.role_changed",
      targetType: "user",
      targetId: USER_ID,
      metadata: { from: "user", to: "expert" },
    });
    expect(result.role).toBe("expert");
  });
});

describe("AdminUserService.flagFairUse", () => {
  it("404s an unknown user", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.flagFairUse(ADMIN, USER_ID, { reason: "spike" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.fairUseFlag.create).not.toHaveBeenCalled();
  });

  it("creates an open flag stamped with the target's tenant + records the audit entry", async () => {
    const tx = makeTx();
    const created = new Date("2026-03-03T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({ id: USER_ID, tenantId: "tenant-x" });
    tx.fairUseFlag.create.mockResolvedValue({
      id: FLAG_ID,
      reason: "spike",
      status: "open",
      createdAt: created,
    });
    const { service, record } = makeService(tx);

    const result = await service.flagFairUse(ADMIN, USER_ID, { reason: "spike" });

    expect(tx.fairUseFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId: "tenant-x", userId: USER_ID, reason: "spike", status: "open" },
      }),
    );
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "user.fair_use_flagged",
      targetType: "user",
      targetId: USER_ID,
      metadata: { flagId: FLAG_ID },
    });
    expect(result).toEqual({
      id: FLAG_ID,
      reason: "spike",
      status: "open",
      createdAt: created.toISOString(),
    });
  });
});

describe("AdminUserService.updateFairUseFlag", () => {
  it("404s an unknown flag", async () => {
    const tx = makeTx();
    tx.fairUseFlag.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.updateFairUseFlag(ADMIN, FLAG_ID, { status: "cleared" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.fairUseFlag.update).not.toHaveBeenCalled();
  });

  it("updates the status and records the audit entry", async () => {
    const tx = makeTx();
    const created = new Date("2026-03-03T00:00:00.000Z");
    tx.fairUseFlag.findUnique.mockResolvedValue({ id: FLAG_ID, userId: USER_ID });
    tx.fairUseFlag.update.mockResolvedValue({
      id: FLAG_ID,
      reason: "spike",
      status: "throttled",
      createdAt: created,
    });
    const { service, record } = makeService(tx);

    const result = await service.updateFairUseFlag(ADMIN, FLAG_ID, { status: "throttled" });

    expect(tx.fairUseFlag.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FLAG_ID }, data: { status: "throttled" } }),
    );
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "user.fair_use_updated",
      targetType: "fair_use_flag",
      targetId: FLAG_ID,
      metadata: { userId: USER_ID, status: "throttled" },
    });
    expect(result.status).toBe("throttled");
  });
});

describe("AdminUserService.requestDeletion", () => {
  it("404s an unknown user", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.requestDeletion(ADMIN, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.dataDeletionRequest.create).not.toHaveBeenCalled();
  });

  it("records a requested-status row + audit entry (completedAt null)", async () => {
    const tx = makeTx();
    const requested = new Date("2026-04-04T00:00:00.000Z");
    tx.user.findUnique.mockResolvedValue({ id: USER_ID, tenantId: "tenant-x" });
    tx.dataDeletionRequest.create.mockResolvedValue({
      id: "dr1",
      userId: USER_ID,
      status: "requested",
      requestedAt: requested,
      completedAt: null,
    });
    const { service, record } = makeService(tx);

    const result = await service.requestDeletion(ADMIN, USER_ID);

    expect(tx.dataDeletionRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId: "tenant-x", userId: USER_ID, status: "requested" },
      }),
    );
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "user.deletion_requested",
      targetType: "user",
      targetId: USER_ID,
      metadata: { requestId: "dr1" },
    });
    expect(result).toEqual({
      id: "dr1",
      userId: USER_ID,
      status: "requested",
      requestedAt: requested.toISOString(),
      completedAt: null,
    });
  });
});

describe("AdminUserService.executeDeletion", () => {
  it("rejects deleting your own account before touching the DB", async () => {
    const tx = makeTx();
    const { service, run } = makeService(tx);

    await expect(service.executeDeletion(ADMIN, ADMIN.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("404s an unknown user", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.executeDeletion(ADMIN, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("audits before the cascade delete, then deletes + logs", async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue({ id: USER_ID, role: "user" });
    tx.user.delete.mockResolvedValue({ id: USER_ID });
    const order: string[] = [];
    const { service, record, info } = makeService(tx);
    record.mockImplementation(() => {
      order.push("audit");
      return Promise.resolve();
    });
    tx.user.delete.mockImplementation(() => {
      order.push("delete");
      return Promise.resolve({ id: USER_ID });
    });

    const result = await service.executeDeletion(ADMIN, USER_ID);

    expect(order).toEqual(["audit", "delete"]);
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "user.data_deleted",
      targetType: "user",
      targetId: USER_ID,
      metadata: { role: "user" },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(info).toHaveBeenCalledWith("user data deleted", { userId: USER_ID, actorId: ADMIN.id });
    expect(result).toEqual({ userId: USER_ID, deleted: true });
  });
});
