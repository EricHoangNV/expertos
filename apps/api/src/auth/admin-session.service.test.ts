import { ForbiddenException } from "@nestjs/common";
import type { PrismaClient } from "@expertos/db";
import { GLOBAL_TENANT_ID } from "@expertos/db";
import { AdminSessionService } from "./admin-session.service";
import type { AuthUser } from "./auth.types";

interface FakeTx {
  $executeRawUnsafe: jest.Mock;
  allowedEmail: { findUnique: jest.Mock };
  user: { update: jest.Mock };
}

function makeFakePrisma(): { prisma: PrismaClient; tx: FakeTx } {
  const tx: FakeTx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    allowedEmail: { findUnique: jest.fn() },
    user: { update: jest.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    $transaction: (cb: (t: FakeTx) => Promise<unknown>) => cb(tx),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: GLOBAL_TENANT_ID,
  firebaseUid: "fb",
  email: "Person@Example.com",
  displayName: "A Person",
  role: "user",
  locale: "en",
};

describe("AdminSessionService.resolve", () => {
  it("authorizes a whitelisted email and syncs the role when it differs", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue({ role: "admin" });

    const result = await new AdminSessionService(prisma).resolve(USER);

    // Lookup is by the lowercased email under the GLOBAL tenant.
    expect(tx.allowedEmail.findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: GLOBAL_TENANT_ID, email: "person@example.com" } },
      select: { role: true },
    });
    // role user → admin triggers a sync.
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: USER.id }, data: { role: "admin" } });
    expect(result).toEqual({
      ok: true,
      role: "admin",
      user: { id: USER.id, email: USER.email, displayName: USER.displayName },
    });
  });

  it("does not write when the DB role already matches the whitelist", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue({ role: "expert" });

    const result = await new AdminSessionService(prisma).resolve({ ...USER, role: "expert" });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(result.role).toBe("expert");
  });

  it("runs the lookup under a GLOBAL-tenant admin/system context", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue({ role: "admin" });

    await new AdminSessionService(prisma).resolve(USER);

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      GLOBAL_TENANT_ID,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SELECT set_config('app.is_admin', $1, true)", "true");
  });

  it("throws 403 when the email is not whitelisted", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue(null);

    await expect(new AdminSessionService(prisma).resolve(USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("revokes a stale elevated role when the email is no longer whitelisted", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue(null);

    // A previously-admin account whose whitelist entry was removed out-of-band still presents a
    // stale `admin` users.role; the sign-in gate must downgrade it before refusing the portal.
    await expect(
      new AdminSessionService(prisma).resolve({ ...USER, role: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: USER.id }, data: { role: "user" } });
  });

  it("throws 403 for a user-roled entry (a consumer-beta invite grants no portal access)", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue({ role: "user" });

    await expect(new AdminSessionService(prisma).resolve(USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("revokes a stale elevated role when the entry was demoted to a beta-only invite", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.allowedEmail.findUnique.mockResolvedValue({ role: "user" });

    await expect(
      new AdminSessionService(prisma).resolve({ ...USER, role: "expert" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: USER.id }, data: { role: "user" } });
  });
});
