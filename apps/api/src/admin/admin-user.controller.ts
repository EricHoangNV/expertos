import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  adminUserListQuerySchema,
  adminUserRoleUpdateSchema,
  fairUseFlagCreateSchema,
  fairUseFlagUpdateSchema,
  type AdminFairUseFlagDto,
  type AdminUserDetailDto,
  type AdminUserListQueryInput,
  type AdminUserRoleUpdateInput,
  type AdminUserSummaryDto,
  type DataDeletionRequestDto,
  type FairUseFlagCreateInput,
  type FairUseFlagUpdateInput,
  type UserDeletionResultDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminUserService } from "./admin-user.service";

/**
 * Admin user / subscription / fair-use management + user-data deletion API (M8.4). Admin-only
 * (`@Roles("admin")`); operates platform-wide via the admin RLS context inside
 * {@link AdminUserService}. Branchy logic + audit logging live in the service (the coverage gate
 * collects `*.service.ts`); this controller validates input and pins identity from the path.
 */
@Controller("admin")
@Roles("admin")
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  /** The user management list (optionally filtered by role and/or an email/name substring). */
  @Get("users")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(adminUserListQuerySchema)) query: AdminUserListQueryInput,
  ): Promise<AdminUserSummaryDto[]> {
    return this.service.list(user, query);
  }

  /** One user's full detail. */
  @Get("users/:id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AdminUserDetailDto> {
    return this.service.get(user, id);
  }

  /** Change a user's role. */
  @Patch("users/:id/role")
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminUserRoleUpdateSchema)) body: AdminUserRoleUpdateInput,
  ): Promise<AdminUserSummaryDto> {
    return this.service.updateRole(user, id, body);
  }

  /** Raise a fair-use flag against a user. */
  @Post("users/:id/fair-use-flags")
  flagFairUse(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fairUseFlagCreateSchema)) body: FairUseFlagCreateInput,
  ): Promise<AdminFairUseFlagDto> {
    return this.service.flagFairUse(user, id, body);
  }

  /** Move a fair-use flag through its review lifecycle. */
  @Patch("fair-use-flags/:id")
  updateFairUseFlag(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fairUseFlagUpdateSchema)) body: FairUseFlagUpdateInput,
  ): Promise<AdminFairUseFlagDto> {
    return this.service.updateFairUseFlag(user, id, body);
  }

  /** Record a user-data deletion request (the workflow row, before the destructive execution). */
  @Post("users/:id/deletion-request")
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<DataDeletionRequestDto> {
    return this.service.requestDeletion(user, id);
  }

  /** Hard-delete a user and all their owned data (the GDPR cascade). */
  @Delete("users/:id")
  executeDeletion(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<UserDeletionResultDto> {
    return this.service.executeDeletion(user, id);
  }
}
