import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  adminExpertActiveUpdateSchema,
  adminExpertCreateSchema,
  adminExpertListQuerySchema,
  adminExpertUpdateSchema,
  expertCalendarSettingsUpdateSchema,
  type AdminExpertActiveUpdateInput,
  type AdminExpertCreateInput,
  type AdminExpertDetailDto,
  type AdminExpertListQueryInput,
  type AdminExpertSummaryDto,
  type AdminExpertUpdateInput,
  type ExpertCalendarSettingsDto,
  type ExpertCalendarSettingsUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminExpertService } from "./admin-expert.service";

/**
 * Admin expert-roster management API (M8.4). Admin-only (`@Roles("admin")`); operates platform-wide
 * via the admin RLS context inside {@link AdminExpertService}. Branchy logic + audit logging live in
 * the service (the coverage gate collects `*.service.ts`); this controller validates input and pins
 * identity from the path.
 */
@Controller("admin/experts")
@Roles("admin")
export class AdminExpertController {
  constructor(private readonly service: AdminExpertService) {}

  /** The expert management list (optionally filtered by active state and/or a slug/name substring). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(adminExpertListQuerySchema)) query: AdminExpertListQueryInput,
  ): Promise<AdminExpertSummaryDto[]> {
    return this.service.list(user, query);
  }

  /** One expert's full detail. */
  @Get(":id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AdminExpertDetailDto> {
    return this.service.get(user, id);
  }

  /** Author a new expert. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(adminExpertCreateSchema)) body: AdminExpertCreateInput,
  ): Promise<AdminExpertDetailDto> {
    return this.service.create(user, body);
  }

  /** Edit an expert's free-text fields and/or operator link. */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminExpertUpdateSchema)) body: AdminExpertUpdateInput,
  ): Promise<AdminExpertDetailDto> {
    return this.service.update(user, id, body);
  }

  /** Activate / deactivate an expert. */
  @Patch(":id/active")
  setActive(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminExpertActiveUpdateSchema)) body: AdminExpertActiveUpdateInput,
  ): Promise<AdminExpertDetailDto> {
    return this.service.setActive(user, id, body);
  }

  /** An expert's TidyCal calendar settings (M16) — token never returned. */
  @Get(":id/calendar")
  getCalendar(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ExpertCalendarSettingsDto> {
    return this.service.getCalendar(user, id);
  }

  /** Set/clear an expert's TidyCal API token (stored encrypted) and/or booking link. */
  @Patch(":id/calendar")
  updateCalendar(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(expertCalendarSettingsUpdateSchema))
    body: ExpertCalendarSettingsUpdateInput,
  ): Promise<ExpertCalendarSettingsDto> {
    return this.service.updateCalendar(user, id, body);
  }
}
