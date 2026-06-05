import { Body, Controller, Get, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import {
  expertAnswerListQuerySchema,
  expertCalendarSettingsUpdateSchema,
  type ExpertAnswerListQueryInput,
  type ExpertAnswerReviewDto,
  type ExpertCalendarSettingsDto,
  type ExpertCalendarSettingsUpdateInput,
  type ExpertConversionsDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExpertPortalService } from "./expert-portal.service";

/**
 * Expert-portal read API (M8.5, PRD §"Expert portal"). `@Roles("expert")` (admin satisfies it via
 * the role hierarchy). A non-admin expert is scoped to their own voice; an admin may target a
 * specific expert with `?expertId=`. All logic lives in the service (the coverage gate collects
 * `*.service.ts`); this controller only parses the optional expert target + page query and delegates.
 */
@Controller("expert")
@Roles("expert")
export class ExpertPortalController {
  constructor(private readonly service: ExpertPortalService) {}

  /** Consultation-conversion summary for the expert's voice (funnel + booked revenue). */
  @Get("conversions")
  conversions(
    @CurrentUser() user: AuthUser,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ExpertConversionsDto> {
    return this.service.conversions(user, expertId ?? null);
  }

  /** A page of AI answers rendered in the expert's voice, newest first, for review. */
  @Get("answers")
  answers(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(expertAnswerListQuerySchema))
    query: ExpertAnswerListQueryInput,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ExpertAnswerReviewDto[]> {
    return this.service.answers(user, expertId ?? null, query);
  }

  /** The caller's own TidyCal calendar settings (M16). The API token is never returned. */
  @Get("calendar-settings")
  getCalendarSettings(
    @CurrentUser() user: AuthUser,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ExpertCalendarSettingsDto> {
    return this.service.getCalendarSettings(user, expertId ?? null);
  }

  /** Set/clear the caller's TidyCal API token (stored encrypted) and/or booking link. */
  @Patch("calendar-settings")
  updateCalendarSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(expertCalendarSettingsUpdateSchema))
    body: ExpertCalendarSettingsUpdateInput,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ExpertCalendarSettingsDto> {
    return this.service.updateCalendarSettings(user, expertId ?? null, body);
  }
}
