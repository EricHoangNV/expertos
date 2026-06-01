import { Controller, Get, Query } from "@nestjs/common";
import {
  usageAnalyticsQuerySchema,
  type UsageAnalyticsDto,
  type UsageAnalyticsQueryInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AnalyticsService } from "./analytics.service";

/**
 * Admin usage & cost analytics API (M10.1). Admin-only (`@Roles("admin")`); the report is
 * platform-wide across all tenants — the admin RLS context inside {@link AnalyticsService} grants the
 * cross-tenant read. All branchy logic lives in the service (the coverage gate collects
 * `*.service.ts`); this controller only validates the query and delegates.
 */
@Controller("admin/analytics")
@Roles("admin")
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  /** Usage & cost totals + per-feature/per-model breakdown + a trailing daily series. */
  @Get("usage")
  usage(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(usageAnalyticsQuerySchema))
    query: UsageAnalyticsQueryInput,
  ): Promise<UsageAnalyticsDto> {
    return this.service.usage(user, query);
  }
}
