import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { HealthService, type HealthStatus } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  check(): HealthStatus {
    return this.health.check();
  }
}
