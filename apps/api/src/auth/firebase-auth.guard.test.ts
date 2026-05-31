import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AuthService } from "./auth.service";
import type { AuthUser } from "./auth.types";
import { extractBearerToken, FirebaseAuthGuard } from "./firebase-auth.guard";
import type { TokenVerifier } from "./token-verifier";

function makeCtx(req: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const authUser: AuthUser = {
  id: "id",
  tenantId: "t",
  firebaseUid: "fb",
  email: "u@example.com",
  displayName: null,
  role: "user",
  locale: "en",
};

describe("extractBearerToken", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["Bearer", null],
    ["Basic abc", null],
    ["Bearer abc.def", "abc.def"],
  ])("parses %p -> %p", (header, expected) => {
    expect(extractBearerToken(header as string | undefined)).toBe(expected);
  });
});

describe("FirebaseAuthGuard", () => {
  function build(overrides: {
    isPublic?: boolean;
    verify?: jest.Mock;
    resolveUser?: jest.Mock;
  }) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(overrides.isPublic ?? false),
    } as unknown as Reflector;
    const tokenVerifier = {
      verify: overrides.verify ?? jest.fn(),
    } as unknown as TokenVerifier;
    const authService = {
      resolveUser: overrides.resolveUser ?? jest.fn(),
    } as unknown as AuthService;
    return {
      guard: new FirebaseAuthGuard(reflector, tokenVerifier, authService),
      tokenVerifier,
    };
  }

  it("allows public routes without verifying a token", async () => {
    const { guard, tokenVerifier } = build({ isPublic: true });
    await expect(guard.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    expect(tokenVerifier.verify).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header", async () => {
    const { guard } = build({});
    await expect(guard.canActivate(makeCtx({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("verifies the token and attaches the resolved user", async () => {
    const verify = jest.fn().mockResolvedValue({ uid: "fb" });
    const resolveUser = jest.fn().mockResolvedValue(authUser);
    const { guard } = build({ verify, resolveUser });
    const req = { headers: { authorization: "Bearer good-token" } } as {
      headers: { authorization: string };
      authUser?: AuthUser;
    };

    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith("good-token");
    expect(req.authUser).toBe(authUser);
  });
});
