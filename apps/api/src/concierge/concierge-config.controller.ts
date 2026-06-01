import { Body, Controller, Get, Patch } from "@nestjs/common";
import {
  reviewConfigUpdateSchema,
  type ReviewConfigDto,
  type ReviewConfigUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ConciergeConfigService } from "./concierge-config.service";

/**
 * Admin concierge trigger-config editor API (M9.1). Admin-only (`@Roles("admin")`); the config is a
 * global singleton so a change is platform-wide. A **mutation** surface — branchy validation + the
 * OD#5 Mode-B gate live in {@link ConciergeConfigService} (the coverage gate collects `*.service.ts`);
 * this controller validates the body via the shared zod schema and delegates.
 */
@Controller("admin/concierge-config")
@Roles("admin")
export class ConciergeConfigController {
  constructor(private readonly service: ConciergeConfigService) {}

  /** The current concierge trigger config. */
  @Get()
  getConfig(@CurrentUser() user: AuthUser): Promise<ReviewConfigDto> {
    return this.service.getConfig(user);
  }

  /** Save the concierge trigger config (global singleton). */
  @Patch()
  updateConfig(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reviewConfigUpdateSchema)) body: ReviewConfigUpdateInput,
  ): Promise<ReviewConfigDto> {
    return this.service.updateConfig(user, body);
  }
}
