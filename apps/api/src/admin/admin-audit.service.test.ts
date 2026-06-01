import { AdminAuditService } from "./admin-audit.service";
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

function makeTx() {
  return {
    adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new AdminAuditService(rls), run };
}

describe("AdminAuditService.record", () => {
  it("appends an entry inside the caller's tx with the actor + all fields", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.record(tx as never, ADMIN, {
      action: "user.role_changed",
      targetType: "user",
      targetId: "99999999-9999-9999-9999-999999999999",
      metadata: { from: "user", to: "expert" },
    });

    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: ADMIN.tenantId,
        actorId: ADMIN.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: "99999999-9999-9999-9999-999999999999",
        metadata: { from: "user", to: "expert" },
      },
    });
  });

  it("nulls the optional fields and omits metadata when absent", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.record(tx as never, ADMIN, { action: "user.data_deleted" });

    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: ADMIN.tenantId,
        actorId: ADMIN.id,
        action: "user.data_deleted",
        targetType: null,
        targetId: null,
        metadata: undefined,
      },
    });
  });
});

describe("AdminAuditService.list", () => {
  it("maps rows newest-first under the admin RLS context, resolving the actor + metadata", async () => {
    const tx = makeTx();
    const created = new Date("2026-05-01T10:00:00.000Z");
    tx.adminAuditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        actorId: ADMIN.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: "u1",
        metadata: { from: "user", to: "expert" },
        createdAt: created,
        actor: { email: "admin@expertos.local", displayName: "Admin" },
      },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(tx.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 50, skip: 0 }),
    );
    expect(result).toEqual([
      {
        id: "a1",
        actorId: ADMIN.id,
        actorEmail: "admin@expertos.local",
        actorName: "Admin",
        action: "user.role_changed",
        targetType: "user",
        targetId: "u1",
        metadata: { from: "user", to: "expert" },
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("narrows by action + targetType and tolerates a deleted actor / null metadata", async () => {
    const tx = makeTx();
    const created = new Date("2026-05-02T10:00:00.000Z");
    tx.adminAuditLog.findMany.mockResolvedValue([
      {
        id: "a2",
        actorId: null,
        action: "user.data_deleted",
        targetType: "user",
        targetId: "u2",
        metadata: null,
        createdAt: created,
        actor: null,
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.list(ADMIN, {
      limit: 10,
      offset: 5,
      action: "user.data_deleted",
      targetType: "user",
    });

    expect(tx.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "user.data_deleted", targetType: "user" },
        take: 10,
        skip: 5,
      }),
    );
    expect(result[0]).toMatchObject({
      actorId: null,
      actorEmail: null,
      actorName: null,
      metadata: null,
    });
  });
});
