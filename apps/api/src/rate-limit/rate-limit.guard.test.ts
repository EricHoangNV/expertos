import { HttpException, HttpStatus, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitGuard, clientIp } from "./rate-limit.guard";
import type { RateLimitResult, RateLimitService } from "./rate-limit.service";

function makeContext(req: Record<string, unknown>): {
  ctx: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const res = { setHeader: (name: string, value: string) => (headers[name] = value) };
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => res as T,
    }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

function makeGuard(skip: boolean | undefined, result?: RateLimitResult) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(skip),
  } as unknown as Reflector;
  const hit = jest.fn().mockReturnValue(result);
  const rateLimit = { hit } as unknown as RateLimitService;
  return { guard: new RateLimitGuard(reflector, rateLimit), hit };
}

const ALLOWED: RateLimitResult = {
  allowed: true,
  limit: 300,
  remaining: 299,
  resetAt: 1_700_000_060_000,
  retryAfterMs: 0,
};

const BLOCKED: RateLimitResult = {
  allowed: false,
  limit: 300,
  remaining: 0,
  resetAt: 1_700_000_060_000,
  retryAfterMs: 12_345,
};

describe("RateLimitGuard", () => {
  it("skips the limiter for a @SkipRateLimit() route", () => {
    const { guard, hit } = makeGuard(true);
    expect(guard.canActivate(makeContext({ headers: {} }).ctx)).toBe(true);
    expect(hit).not.toHaveBeenCalled();
  });

  it("allows an under-limit request and sets the X-RateLimit-* headers (no Retry-After)", () => {
    const { guard, hit } = makeGuard(undefined, ALLOWED);
    const { ctx, headers } = makeContext({
      headers: { "x-forwarded-for": "203.0.113.7, 70.0.0.1" },
    });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(hit).toHaveBeenCalledWith("203.0.113.7");
    expect(headers["X-RateLimit-Limit"]).toBe("300");
    expect(headers["X-RateLimit-Remaining"]).toBe("299");
    // resetAt (ms) → epoch seconds, ceil.
    expect(headers["X-RateLimit-Reset"]).toBe("1700000060");
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("throws a 429 with a retry payload + Retry-After header when over the limit", () => {
    const { guard } = makeGuard(undefined, BLOCKED);
    const { ctx, headers } = makeContext({ headers: {}, ip: "198.51.100.4" });

    try {
      guard.canActivate(ctx);
      throw new Error("expected the guard to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(http.getResponse()).toEqual({
        reason: "rate_limited",
        message: "Too many requests",
        retryAfterSeconds: 13, // ceil(12345 / 1000)
      });
    }
    expect(headers["Retry-After"]).toBe("13");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });
});

describe("clientIp", () => {
  it("prefers the leftmost X-Forwarded-For hop, trimmed", () => {
    expect(clientIp({ headers: { "x-forwarded-for": "  1.2.3.4 , 5.6.7.8" } })).toBe("1.2.3.4");
  });

  it("handles a header delivered as a string array", () => {
    expect(clientIp({ headers: { "x-forwarded-for": ["9.9.9.9", "1.1.1.1"] } })).toBe("9.9.9.9");
  });

  it("falls back to req.ip when no forwarded header is present", () => {
    expect(clientIp({ headers: {}, ip: "10.0.0.1" })).toBe("10.0.0.1");
  });

  it("falls back to the socket address, then to a shared unknown bucket", () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: "10.0.0.2" } })).toBe("10.0.0.2");
    expect(clientIp({ headers: {} })).toBe("unknown");
    // An empty forwarded value falls through to the socket/unknown chain.
    expect(clientIp({ headers: { "x-forwarded-for": "" } })).toBe("unknown");
  });
});
