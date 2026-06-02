import { ProfileService } from "./profile.service";
import type { RlsService } from "./rls.service";
import type { AuthUser } from "./auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: "Mai",
  role: "user",
  locale: "en",
};

function makeService() {
  const tx = { user: { update: jest.fn() } };
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new ProfileService(rls), tx, run };
}

describe("ProfileService.updateLocale", () => {
  it("updates the acting user's own row under their RLS context and returns the profile", async () => {
    const { service, tx, run } = makeService();
    tx.user.update.mockResolvedValue({
      id: USER.id,
      email: USER.email,
      displayName: "Mai",
      role: "user",
      locale: "vi",
    });

    const result = await service.updateLocale(USER, "vi");

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: USER.id },
      data: { locale: "vi" },
      select: { id: true, email: true, displayName: true, role: true, locale: true },
    });
    expect(result).toEqual({
      id: USER.id,
      email: USER.email,
      displayName: "Mai",
      role: "user",
      locale: "vi",
    });
  });
});
