import type { PrismaClient } from "@expertos/db";
import { GLOBAL_TENANT_ID } from "@expertos/db";
import { AuthService } from "./auth.service";

interface FakeTx {
  $executeRawUnsafe: jest.Mock;
  user: { findUnique: jest.Mock; create: jest.Mock };
}

function makeFakePrisma(): { prisma: PrismaClient; tx: FakeTx } {
  const tx: FakeTx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    user: { findUnique: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: (cb: (t: FakeTx) => Promise<unknown>) => cb(tx),
  } as unknown as PrismaClient;
  return { prisma, tx };
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

    const result = await new AuthService(prisma).resolveUser({
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

    await new AuthService(prisma).resolveUser({ uid: "fb-uid" });

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

    const result = await new AuthService(prisma).resolveUser({ uid: "fb-uid" });

    expect(tx.user.create).toHaveBeenCalledWith({
      data: { firebaseUid: "fb-uid", email: "", displayName: null },
    });
    expect(result.role).toBe("user");
    expect(result.email).toBe("");
    expect(result.displayName).toBeNull();
  });
});
