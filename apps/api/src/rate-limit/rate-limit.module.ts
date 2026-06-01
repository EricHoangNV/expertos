import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  RATE_LIMIT_OPTIONS,
  resolveRateLimitOptions,
} from "./rate-limit.config";
import { RateLimitGuard } from "./rate-limit.guard";
import { RateLimitService } from "./rate-limit.service";

/**
 * Wires the M11.2 per-IP HTTP rate limiter. {@link RateLimitGuard} is registered as a global guard;
 * importing this module *first* in {@link AppModule} makes it the first global guard to run, so a
 * burst is throttled before the auth guards spend any token-verification work on it.
 *
 * The limiter config is resolved from the environment once at boot (env-tunable, see
 * {@link resolveRateLimitOptions}); the service holds the in-process counter (the documented
 * Memorystore Redis swap point).
 */
@Module({
  providers: [
    { provide: RATE_LIMIT_OPTIONS, useFactory: () => resolveRateLimitOptions() },
    RateLimitService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class RateLimitModule {}
