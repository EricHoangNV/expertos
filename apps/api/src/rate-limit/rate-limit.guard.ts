import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitService } from "./rate-limit.service";
import { SKIP_RATE_LIMIT_KEY } from "./skip-rate-limit.decorator";

/** Minimal request shape the guard reads — declared structurally to avoid an Express type dependency. */
interface RateLimitedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/** Minimal response shape — only the header setter the guard touches (the chat SSE pattern). */
interface RateLimitedResponse {
  setHeader(name: string, value: string): void;
}

/**
 * The coarse per-IP request limiter (M11.2), registered as the first global guard so a burst is
 * throttled *before* the auth guard does any token-verification work. Keyed by client IP — the
 * complement to the per-user metered quota (the entitlement guard, M6.1): this bounds raw request
 * volume from a single source (including unauthenticated traffic to the public webhook/auth routes),
 * the entitlement guard bounds a signed-in user's answer consumption.
 *
 * Every response carries the `X-RateLimit-*` headers for transparency; a blocked request additionally
 * gets `Retry-After` and a `429` whose body (`reason: "rate_limited"`, `retryAfterSeconds`) is echoed
 * verbatim by {@link AllExceptionsFilter} (which also logs the rejection — so the guard itself does
 * not log the IP, keeping PII out of the logs). Routes marked `@SkipRateLimit()` are exempt.
 *
 * NOTE: the client IP is taken from the leftmost `X-Forwarded-For` hop. Behind Cloud Run / a trusted
 * LB this is the real client; a hostile client on an untrusted edge can spoof it, so a production
 * deployment should treat this as defense-in-depth beneath a platform edge limiter (Cloud Armor).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<RateLimitedRequest>();
    const res = http.getResponse<RateLimitedResponse>();

    const result = this.rateLimit.hit(clientIp(req));
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      throw new HttpException(
        { reason: "rate_limited", message: "Too many requests", retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Resolves the client IP used as the rate-limit key: the leftmost `X-Forwarded-For` hop (the original
 * client behind a trusted proxy), falling back to the socket address, then a shared `"unknown"`
 * bucket. The shared fallback is deliberate — an IP-less request still counts against *something*.
 */
export function clientIp(req: RateLimitedRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    const first = raw.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
