import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { SkipRateLimit } from "../rate-limit/skip-rate-limit.decorator";
import { HealthService, type HealthStatus } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // `@SkipRateLimit()` so Cloud Run's tight-interval health polling never consumes a client IP budget.
  @Public()
  @SkipRateLimit()
  @Get()
  check(): HealthStatus {
    return this.health.check();
  }
}
