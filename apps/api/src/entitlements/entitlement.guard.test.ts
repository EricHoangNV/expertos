import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EntitlementGuard } from "./entitlement.guard";
import type { EntitlementService } from "./entitlement.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

function makeContext(authUser?: AuthUser): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: <T>() => ({ authUser }) as T }),
  } as unknown as ExecutionContext;
}

function makeGuard(metadata: string | undefined, enforce = jest.fn()) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(metadata) } as unknown as Reflector;
  const entitlements = { enforce } as unknown as EntitlementService;
  return { guard: new EntitlementGuard(reflector, entitlements), enforce };
}

describe("EntitlementGuard", () => {
  it("allows a route with no @RequiresEntitlement requirement", async () => {
    const { guard, enforce } = makeGuard(undefined);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
    expect(enforce).not.toHaveBeenCalled();
  });

  it("throws Unauthorized when no authenticated user is attached", async () => {
    const { guard } = makeGuard("ask_question");
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("enforces the required feature and allows when it passes", async () => {
    const enforce = jest.fn().mockResolvedValue(undefined);
    const { guard } = makeGuard("ask_question", enforce);
    await expect(guard.canActivate(makeContext(USER))).resolves.toBe(true);
    expect(enforce).toHaveBeenCalledWith(USER, "ask_question");
  });

  it("propagates the 402 the service throws at the wall", async () => {
    const enforce = jest.fn().mockRejectedValue(new Error("402"));
    const { guard } = makeGuard("ask_question", enforce);
    await expect(guard.canActivate(makeContext(USER))).rejects.toThrow("402");
  });
});
