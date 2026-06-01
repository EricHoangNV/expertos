import { Controller, Get, Query } from "@nestjs/common";
import {
  revenueReportQuerySchema,
  type RevenueReportDto,
  type RevenueReportQueryInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RevenueService } from "./revenue.service";

/**
 * Admin revenue reporting API (M8.3). Admin-only (`@Roles("admin")`); the report is platform-wide
 * across all tenants — the admin RLS context inside {@link RevenueService} grants the cross-tenant
 * read. All branchy logic lives in the service (the coverage gate collects `*.service.ts`); this
 * controller only validates the query and delegates.
 */
@Controller("admin/revenue")
@Roles("admin")
export class RevenueController {
  constructor(private readonly service: RevenueService) {}

  /** MRR + per-plan breakdown + a trailing monthly ledger series with the AI-cost margin signal. */
  @Get("report")
  report(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(revenueReportQuerySchema))
    query: RevenueReportQueryInput,
  ): Promise<RevenueReportDto> {
    return this.service.report(user, query);
  }
}
