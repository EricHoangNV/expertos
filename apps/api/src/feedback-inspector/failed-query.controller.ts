import { Controller, Get, Query } from "@nestjs/common";
import {
  failedQueryListQuerySchema,
  type FailedQueryDto,
  type FailedQueryListQueryInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FailedQueryService } from "./failed-query.service";

/**
 * Admin failed / low-confidence query inspector API (M8.3). Admin-only (`@Roles("admin")`); the feed
 * is platform-wide across all tenants — the admin RLS context inside {@link FailedQueryService} grants
 * the cross-tenant read. Read-only. All logic lives in the service (the coverage gate collects
 * `*.service.ts`); this controller only validates the page query and delegates.
 */
@Controller("admin/failed-queries")
@Roles("admin")
export class FailedQueryController {
  constructor(private readonly service: FailedQueryService) {}

  /** A page of the most-recent unhelpful-rated (👎) answers, newest first. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(failedQueryListQuerySchema))
    query: FailedQueryListQueryInput,
  ): Promise<FailedQueryDto[]> {
    return this.service.list(user, query);
  }
}
