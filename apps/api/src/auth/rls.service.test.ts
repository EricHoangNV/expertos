import type { PrismaClient } from "@expertos/db";
import { GLOBAL_TENANT_ID } from "@expertos/db";
import type { AuthUser } from "./auth.types";
import { RlsService } from "./rls.service";

interface FakeTx {
  $executeRawUnsafe: jest.Mock;
}

function makeFakePrisma(): { prisma: PrismaClient; tx: FakeTx } {
  const tx: FakeTx = { $executeRawUnsafe: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    $transaction: (cb: (t: FakeTx) => Promise<unknown>) => cb(tx),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

const baseUser: AuthUser = {
  id: "22222222-2222-2222-2222-222222222222",
  tenantId: GLOBAL_TENANT_ID,
  firebaseUid: "fb",
  email: "u@example.com",
  displayName: null,
  role: "user",
  locale: "en",
};

describe("RlsService.run", () => {
  it("scopes work to the user's tenant + user with is_admin=false for non-admins", async () => {
    const { prisma, tx } = makeFakePrisma();

    const result = await new RlsService(prisma).run(baseUser, async (t) => {
      expect(t).toBe(tx);
      return "work-result";
    });

    expect(result).toBe("work-result");
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.current_user_id', $1, true)",
      baseUser.id,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.is_admin', $1, true)",
      "false",
    );
  });

  it("grants is_admin=true for admin-role users", async () => {
    const { prisma, tx } = makeFakePrisma();

    await new RlsService(prisma).run({ ...baseUser, role: "admin" }, async () => 1);

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.is_admin', $1, true)",
      "true",
    );
  });
});
