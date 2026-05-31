import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { Role } from "@expertos/shared";
import type { AuthUser } from "./auth.types";
import { RolesGuard } from "./roles.guard";

function makeCtx(req: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardFor(required: Role | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const user = (role: Role): { authUser: AuthUser } => ({
  authUser: {
    id: "id",
    tenantId: "t",
    firebaseUid: "fb",
    email: "u@example.com",
    displayName: null,
    role,
    locale: "en",
  },
});

describe("RolesGuard", () => {
  it("allows routes with no role requirement", () => {
    expect(guardFor(undefined).canActivate(makeCtx(user("user")))).toBe(true);
  });

  it("allows when the user's role meets or exceeds the requirement", () => {
    expect(guardFor("expert").canActivate(makeCtx(user("admin")))).toBe(true);
    expect(guardFor("expert").canActivate(makeCtx(user("expert")))).toBe(true);
  });

  it("forbids when the user's role is insufficient", () => {
    expect(() => guardFor("admin").canActivate(makeCtx(user("user")))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects when no authenticated user is present", () => {
    expect(() => guardFor("user").canActivate(makeCtx({}))).toThrow(
      UnauthorizedException,
    );
  });
});
