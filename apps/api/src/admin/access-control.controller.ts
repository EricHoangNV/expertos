import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  allowedEmailCreateSchema,
  allowedEmailUpdateSchema,
  type AllowedEmailCreateInput,
  type AllowedEmailDto,
  type AllowedEmailUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccessControlService } from "./access-control.service";

/**
 * Admin-portal whitelist management API (M14). Admin-only (`@Roles("admin")`); operates platform-wide
 * via the admin RLS context inside {@link AccessControlService}. Branchy logic + self-lockout
 * protection + audit logging live in the service (the coverage gate collects `*.service.ts`); this
 * controller validates input and pins identity from the path.
 */
@Controller("admin/access-control")
@Roles("admin")
export class AccessControlController {
  constructor(private readonly service: AccessControlService) {}

  /** The whitelist, newest first. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AllowedEmailDto[]> {
    return this.service.list(user);
  }

  /** Add an email to the whitelist. */
  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(allowedEmailCreateSchema)) body: AllowedEmailCreateInput,
  ): Promise<AllowedEmailDto> {
    return this.service.add(user, body);
  }

  /** Change a whitelist entry's role. */
  @Patch(":id")
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(allowedEmailUpdateSchema)) body: AllowedEmailUpdateInput,
  ): Promise<AllowedEmailDto> {
    return this.service.updateRole(user, id, body);
  }

  /** Remove an email from the whitelist. */
  @Delete(":id")
  @HttpCode(200)
  remove(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.service.remove(user, id);
  }
}
