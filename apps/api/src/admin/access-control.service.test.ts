import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@expertos/db";
import { AccessControlService } from "./access-control.service";
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

const ENTRY_ID = "33333333-3333-3333-3333-333333333333";

function makeTx() {
  return {
    allowedEmail: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const logger = { info: jest.fn() } as unknown as StructuredLogger;
  return { service: new AccessControlService(rls, audit, logger), run, record };
}

function dtoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    email: "expert@example.com",
    role: "expert" as const,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: { email: "admin@expertos.local" },
    ...overrides,
  };
}

describe("AccessControlService.list", () => {
  it("maps rows newest-first with the resolved adder email", async () => {
    const tx = makeTx();
    tx.allowedEmail.findMany.mockResolvedValue([dtoRow(), dtoRow({ id: "e2", creator: null })]);
    const { service, run } = makeService(tx);

    const result = await service.list(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(tx.allowedEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
    expect(result).toEqual([
      {
        id: ENTRY_ID,
        email: "expert@example.com",
        role: "expert",
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        createdByEmail: "admin@expertos.local",
      },
      expect.objectContaining({ id: "e2", createdByEmail: null }),
    ]);
  });
});

describe("AccessControlService.list", () => {
  it("returns a user-roled beta invite as-is (no collapse to a portal role)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findMany.mockResolvedValue([dtoRow({ role: "user", email: "beta@example.com" })]);
    const { service } = makeService(tx);

    const result = await service.list(ADMIN);

    expect(result[0]).toMatchObject({ email: "beta@example.com", role: "user" });
  });
});

describe("AccessControlService.add", () => {
  it("creates an entry in the actor's tenant stamped with createdBy and audits it", async () => {
    const tx = makeTx();
    tx.allowedEmail.create.mockResolvedValue(dtoRow({ role: "admin", email: "new@example.com" }));
    const { service, record } = makeService(tx);

    const result = await service.add(ADMIN, { email: "new@example.com", role: "admin" });

    expect(tx.allowedEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId: ADMIN.tenantId,
          email: "new@example.com",
          role: "admin",
          createdBy: ADMIN.id,
        },
      }),
    );
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({
        action: "access_control.email_added",
        targetType: "allowed_email",
        metadata: { email: "new@example.com", role: "admin" },
      }),
    );
    expect(result.role).toBe("admin");
  });

  it("adds a user-roled beta invite", async () => {
    const tx = makeTx();
    tx.allowedEmail.create.mockResolvedValue(dtoRow({ role: "user", email: "beta@example.com" }));
    const { service } = makeService(tx);

    const result = await service.add(ADMIN, { email: "beta@example.com", role: "user" });

    expect(tx.allowedEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "user" }) }),
    );
    expect(result.role).toBe("user");
  });

  it("maps a unique-constraint (P2002) violation to a 409", async () => {
    const tx = makeTx();
    tx.allowedEmail.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }),
    );
    const { service, record } = makeService(tx);

    await expect(
      service.add(ADMIN, { email: "dup@example.com", role: "expert" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(record).not.toHaveBeenCalled();
  });

  it("rethrows a non-unique create error unchanged", async () => {
    const tx = makeTx();
    tx.allowedEmail.create.mockRejectedValue(new Error("boom"));
    const { service } = makeService(tx);

    await expect(service.add(ADMIN, { email: "a@b.com", role: "expert" })).rejects.toThrow("boom");
  });
});

describe("AccessControlService.updateRole", () => {
  it("changes the role and audits from→to", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: "expert@example.com", role: "expert" });
    tx.allowedEmail.update.mockResolvedValue(dtoRow({ role: "admin" }));
    const { service, record } = makeService(tx);

    const result = await service.updateRole(ADMIN, ENTRY_ID, { role: "admin" });

    expect(tx.allowedEmail.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ENTRY_ID }, data: { role: "admin" } }),
    );
    // Source-of-truth sync: the new role is mirrored onto the matching user row.
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: "expert@example.com", mode: "insensitive" } },
      data: { role: "admin" },
    });
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({
        action: "access_control.role_changed",
        metadata: { email: "expert@example.com", from: "expert", to: "admin" },
      }),
    );
    expect(result.role).toBe("admin");
  });

  it("throws 404 when the entry does not exist", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.updateRole(ADMIN, ENTRY_ID, { role: "admin" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.allowedEmail.update).not.toHaveBeenCalled();
  });

  it("rejects demoting your own admin access (self-lockout)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: ADMIN.email, role: "admin" });
    const { service, record } = makeService(tx);

    await expect(service.updateRole(ADMIN, ENTRY_ID, { role: "expert" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.allowedEmail.update).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("demoting an entry mirrors the lower role onto the user (immediate revocation)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: "ex@example.com", role: "admin" });
    tx.allowedEmail.update.mockResolvedValue(dtoRow({ email: "ex@example.com", role: "expert" }));
    const { service } = makeService(tx);

    await service.updateRole(ADMIN, ENTRY_ID, { role: "expert" });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: "ex@example.com", mode: "insensitive" } },
      data: { role: "expert" },
    });
  });

  it("rejects demoting your own entry to a beta-only invite (self-lockout)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: ADMIN.email, role: "admin" });
    const { service } = makeService(tx);

    await expect(service.updateRole(ADMIN, ENTRY_ID, { role: "user" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.allowedEmail.update).not.toHaveBeenCalled();
  });

  it("allows re-setting your own entry to admin (no demotion)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: ADMIN.email, role: "admin" });
    tx.allowedEmail.update.mockResolvedValue(dtoRow({ email: ADMIN.email, role: "admin" }));
    const { service } = makeService(tx);

    await expect(service.updateRole(ADMIN, ENTRY_ID, { role: "admin" })).resolves.toBeDefined();
    expect(tx.allowedEmail.update).toHaveBeenCalled();
  });
});

describe("AccessControlService.remove", () => {
  it("deletes the entry and audits it", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: "expert@example.com", role: "expert" });
    tx.allowedEmail.delete.mockResolvedValue(undefined);
    const { service, record } = makeService(tx);

    const result = await service.remove(ADMIN, ENTRY_ID);

    expect(tx.allowedEmail.delete).toHaveBeenCalledWith({ where: { id: ENTRY_ID } });
    // Source-of-truth sync: a removed operator is dropped back to the base `user` role.
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: "expert@example.com", mode: "insensitive" } },
      data: { role: "user" },
    });
    expect(record).toHaveBeenCalledWith(
      tx,
      ADMIN,
      expect.objectContaining({
        action: "access_control.email_removed",
        metadata: { email: "expert@example.com", role: "expert" },
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("throws 404 when the entry does not exist", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.remove(ADMIN, ENTRY_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.allowedEmail.delete).not.toHaveBeenCalled();
  });

  it("rejects removing your own entry (self-lockout)", async () => {
    const tx = makeTx();
    tx.allowedEmail.findUnique.mockResolvedValue({ email: ADMIN.email, role: "admin" });
    const { service, record } = makeService(tx);

    await expect(service.remove(ADMIN, ENTRY_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.allowedEmail.delete).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
