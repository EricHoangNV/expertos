import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  recommendationRespondSchema,
  type RecommendationRespondInput,
  type RecommendationResponseResultDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RecommendationService } from "./recommendation.service";

/**
 * Consultation-recommendation response API (M7.2, PRD §"Consultation funnel"). The in-chat
 * recommendation is surfaced on the chat `done` event (M7.1); this records the user's Book / Maybe
 * later / Ask another choice against the persisted recommendation. `@Roles('user')` is the broadest
 * authenticated audience; ownership is enforced by Postgres RLS inside {@link RecommendationService}
 * (`consultation_recommendations` is user-scoped). Booking is available to every paid tier (the
 * `consultation_booking` entitlement is enabled on all plans), so the route isn't entitlement-gated.
 * All branchy logic lives in the service (only `*.service.ts` is coverage-gated).
 */
@Controller("consultation-recommendations")
@Roles("user")
export class ConsultationRecommendationsController {
  constructor(private readonly recommendation: RecommendationService) {}

  /** Record the user's response; `book` returns the TidyCal booking link to open. */
  @Post(":id/respond")
  respond(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recommendationRespondSchema))
    body: RecommendationRespondInput,
  ): Promise<RecommendationResponseResultDto> {
    return this.recommendation.respond(user, id, body);
  }
}
