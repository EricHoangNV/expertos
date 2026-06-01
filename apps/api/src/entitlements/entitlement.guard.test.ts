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

function makeContext(authUser?: AuthUser): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { authUser };
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: <T>() => req as T }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeGuard(metadata: string | undefined, enforce = jest.fn()) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(metadata) } as unknown as Reflector;
  const entitlements = { enforce } as unknown as EntitlementService;
  return { guard: new EntitlementGuard(reflector, entitlements), enforce };
}

describe("EntitlementGuard", () => {
  it("allows a route with no @RequiresEntitlement requirement", async () => {
    const { guard, enforce } = makeGuard(undefined);
    await expect(guard.canActivate(makeContext(USER).ctx)).resolves.toBe(true);
    expect(enforce).not.toHaveBeenCalled();
  });

  it("throws Unauthorized when no authenticated user is attached", async () => {
    const { guard } = makeGuard("ask_question");
    await expect(guard.canActivate(makeContext(undefined).ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("enforces the required feature, allows, and stashes the gate decision on the request (M6.3)", async () => {
    const decision = { outcome: "degraded", feature: "ask_question" };
    const enforce = jest.fn().mockResolvedValue(decision);
    const { guard } = makeGuard("ask_question", enforce);
    const { ctx, req } = makeContext(USER);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(enforce).toHaveBeenCalledWith(USER, "ask_question");
    // Stashed so @EntitlementDecisionParam() can read the fair-use tier downstream.
    expect(req.entitlementDecision).toEqual(decision);
  });

  it("propagates the 402 the service throws at the wall", async () => {
    const enforce = jest.fn().mockRejectedValue(new Error("402"));
    const { guard } = makeGuard("ask_question", enforce);
    await expect(guard.canActivate(makeContext(USER).ctx)).rejects.toThrow("402");
  });
});
