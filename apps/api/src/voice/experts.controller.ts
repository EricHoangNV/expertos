import { Controller, Get, Query } from "@nestjs/common";
import { expertListQuerySchema, type ExpertListQueryInput } from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { VoiceService } from "./voice.service";
import type { ExpertVoiceMeta } from "./voice.types";

/**
 * Read-only expert-voice picker surface (M2.2 → first consumed by the M3.1 chat UI). Any
 * authenticated user may list the selectable voices — no `@Roles` gate — and the chat request
 * carries the chosen `expertId`. Only active experts with a published profile are returned (the
 * eligibility lives in {@link VoiceService.listExperts}), so the picker never offers a dead voice.
 */
@Controller("experts")
export class ExpertsController {
  constructor(private readonly voice: VoiceService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(expertListQuerySchema))
    query: ExpertListQueryInput,
  ): Promise<ExpertVoiceMeta[]> {
    return this.voice.listExperts(user, query);
  }
}
