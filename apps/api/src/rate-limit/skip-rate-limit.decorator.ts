import { SetMetadata } from "@nestjs/common";

export const SKIP_RATE_LIMIT_KEY = "skipRateLimit";

/**
 * Opts a route (or controller) out of the global {@link RateLimitGuard}. Reserved for high-frequency
 * infrastructure endpoints that are not an abuse vector — e.g. the `@Public()` health check Cloud Run
 * polls on a tight interval, which would otherwise consume a client's IP budget.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
