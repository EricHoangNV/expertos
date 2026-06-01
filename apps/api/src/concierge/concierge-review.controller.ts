import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  conciergeQueueListQuerySchema,
  reviewResponseCreateSchema,
  type ConciergeQueueListQueryInput,
  type ReviewQueueDetailDto,
  type ReviewQueueItemDto,
  type ReviewResponseCreateInput,
  type ReviewResponseDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ConciergeReviewService } from "./concierge-review.service";

/**
 * Concierge review-queue API (M9.2, PRD §"Expert portal" → "Concierge review queue"). `@Roles("expert")`
 * (admin satisfies it via the role hierarchy). A non-admin expert is scoped to their own voice; an
 * admin may target a specific expert with `?expertId=`. All logic (the elevated-but-bounded voice
 * scope, verdict/edit) lives in the service (the coverage gate collects `*.service.ts`); this
 * controller parses the page query + body and delegates.
 */
@Controller("concierge-reviews")
@Roles("expert")
export class ConciergeReviewController {
  constructor(private readonly service: ConciergeReviewService) {}

  /** The reviewer's queue of flagged answers, most-actionable first. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(conciergeQueueListQuerySchema))
    query: ConciergeQueueListQueryInput,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ReviewQueueItemDto[]> {
    return this.service.list(user, expertId ?? null, query);
  }

  /** Full detail for one queued review (answer + prompting question + responses). */
  @Get(":id")
  get(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ReviewQueueDetailDto> {
    return this.service.get(user, expertId ?? null, id);
  }

  /** Record a reviewer verdict (Good / Bad / Great) + optional edit on a queued answer. */
  @Post(":id/respond")
  respond(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewResponseCreateSchema)) body: ReviewResponseCreateInput,
    @Query("expertId", new ParseUUIDPipe({ optional: true })) expertId?: string,
  ): Promise<ReviewResponseDto> {
    return this.service.respond(user, expertId ?? null, id, body);
  }
}
