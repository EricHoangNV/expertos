import { Controller, Get, Query } from "@nestjs/common";
import {
  adminAuditListQuerySchema,
  type AdminAuditListQueryInput,
  type AdminAuditLogDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuditService } from "./admin-audit.service";

/**
 * Admin audit-log API (M8.4). Admin-only (`@Roles("admin")`); the feed is platform-wide across all
 * tenants via the admin RLS context inside {@link AdminAuditService}. Read-only — entries are
 * appended server-side alongside the action that produced them, never via an HTTP route.
 */
@Controller("admin/audit-logs")
@Roles("admin")
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  /** A page of audit entries, newest first; optionally filtered by action / target type. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(adminAuditListQuerySchema)) query: AdminAuditListQueryInput,
  ): Promise<AdminAuditLogDto[]> {
    return this.service.list(user, query);
  }
}
