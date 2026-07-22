import { ForbiddenException } from "@nestjs/common";
import type { PrismaClient } from "@expertos/db";
import { GLOBAL_TENANT_ID } from "@expertos/db";
import { AuthService, BETA_ACCESS_DENIED } from "./auth.service";
import type { BetaGateService } from "./beta-gate.service";

interface FakeTx {
  $executeRawUnsafe: jest.Mock;
  user: { findUnique: jest.Mock; create: jest.Mock };
  allowedEmail: { findUnique: jest.Mock };
}

function makeFakePrisma(): { prisma: PrismaClient; tx: FakeTx } {
  const tx: FakeTx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    user: { findUnique: jest.fn(), create: jest.fn() },
    allowedEmail: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    $transaction: (cb: (t: FakeTx) => Promise<unknown>) => cb(tx),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

/** A BetaGateService stub pinned to one state; `isEnabled` is a jest.Mock for call assertions. */
function makeGate(enabled: boolean): BetaGateService {
  return { isEnabled: jest.fn().mockResolvedValue(enabled), bust: jest.fn() } as unknown as BetaGateService;
}

const dbUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: GLOBAL_TENANT_ID,
  firebaseUid: "fb-uid",
  email: "expert@example.com",
  displayName: "Dr. Expert",
  role: "expert" as const,
  locale: "en" as const,
};

describe("AuthService.resolveUser", () => {
  it("returns the existing user without creating one", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.user.findUnique.mockResolvedValue(dbUser);

    const result = await new AuthService(prisma, makeGate(false)).resolveUser({
      uid: "fb-uid",
      email: "expert@example.com",
      name: "Dr. Expert",
    });

    expect(result).toEqual({
      id: dbUser.id,
      tenantId: GLOBAL_TENANT_ID,
      firebaseUid: "fb-uid",
      email: "expert@example.com",
      displayName: "Dr. Expert",
      role: "expert",
      locale: "en",
    });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("scopes the lookup under an admin/system RLS context", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.user.findUnique.mockResolvedValue(dbUser);

    await new AuthService(prisma, makeGate(false)).resolveUser({ uid: "fb-uid" });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      GLOBAL_TENANT_ID,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.is_admin', $1, true)",
      "true",
    );
  });

  it("creates a new user on first sign-in, defaulting missing email/name", async () => {
    const { prisma, tx } = makeFakePrisma();
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ ...dbUser, email: "", displayName: null, role: "user" });

    const result = await new AuthService(prisma, makeGate(false)).resolveUser({ uid: "fb-uid" });

    expect(tx.user.create).toHaveBeenCalledWith({
      data: { firebaseUid: "fb-uid", email: "", displayName: null },
    });
    expect(result.role).toBe("user");
    expect(result.email).toBe("");
    expect(result.displayName).toBeNull();
  });

  describe("private beta gate", () => {
    const memberUser = { ...dbUser, email: "Member@Example.com", role: "user" as const };

    it("skips the whitelist entirely when the gate is off", async () => {
      const { prisma, tx } = makeFakePrisma();
      tx.user.findUnique.mockResolvedValue(memberUser);

      await new AuthService(prisma, makeGate(false)).resolveUser({ uid: "fb-uid" });

      expect(tx.allowedEmail.findUnique).not.toHaveBeenCalled();
    });

    it("403s a non-whitelisted user-roled account with the BETA_ACCESS_DENIED code", async () => {
      const { prisma, tx } = makeFakePrisma();
      tx.user.findUnique.mockResolvedValue(memberUser);
      tx.allowedEmail.findUnique.mockResolvedValue(null);

      const call = new AuthService(prisma, makeGate(true)).resolveUser({ uid: "fb-uid" });

      await expect(call).rejects.toThrow(ForbiddenException);
      await call.catch((err: ForbiddenException) => {
        expect(err.getResponse()).toMatchObject({ code: BETA_ACCESS_DENIED });
      });
    });

    it("passes a whitelisted user, looking the email up normalized (trim + lowercase)", async () => {
      const { prisma, tx } = makeFakePrisma();
      tx.user.findUnique.mockResolvedValue(memberUser);
      tx.allowedEmail.findUnique.mockResolvedValue({ id: "row-id" });

      const result = await new AuthService(prisma, makeGate(true)).resolveUser({ uid: "fb-uid" });

      expect(tx.allowedEmail.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_email: { tenantId: GLOBAL_TENANT_ID, email: "member@example.com" },
        },
        select: { id: true },
      });
      expect(result.role).toBe("user");
    });

    it("skips the whitelist lookup for elevated roles (synced from the whitelist already)", async () => {
      const { prisma, tx } = makeFakePrisma();
      tx.user.findUnique.mockResolvedValue(dbUser); // role: expert

      await new AuthService(prisma, makeGate(true)).resolveUser({ uid: "fb-uid" });

      expect(tx.allowedEmail.findUnique).not.toHaveBeenCalled();
    });

    it("gates first sign-in too: a fresh non-whitelisted account is denied", async () => {
      const { prisma, tx } = makeFakePrisma();
      tx.user.findUnique.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(memberUser);
      tx.allowedEmail.findUnique.mockResolvedValue(null);

      await expect(
        new AuthService(prisma, makeGate(true)).resolveUser({
          uid: "fb-uid",
          email: "Member@Example.com",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
