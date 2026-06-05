import { Body, Controller, Get, Patch } from "@nestjs/common";
import {
  appSettingsUpdateSchema,
  type AppSettingsDto,
  type AppSettingsUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SettingsService } from "./settings.service";

/**
 * Admin runtime answer-tuning settings API (M17.2). Admin-only (`@Roles("admin")`); the settings are a
 * global singleton so a change is platform-wide. A **mutation** surface — the upsert + audit + cache
 * bust live in {@link SettingsService} (the coverage gate collects `*.service.ts`); this controller
 * validates the body via the shared zod schema (temp ∈ [0,2], model ∈ allowlist, floor ∈ [0,1]) and
 * delegates.
 */
@Controller("admin/app-settings")
@Roles("admin")
export class AppSettingsController {
  constructor(private readonly service: SettingsService) {}

  /** The current runtime answer-tuning settings (global singleton). */
  @Get()
  getSettings(@CurrentUser() user: AuthUser): Promise<AppSettingsDto> {
    return this.service.getSettings(user);
  }

  /** Save the runtime answer-tuning settings (global singleton). */
  @Patch()
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(appSettingsUpdateSchema)) body: AppSettingsUpdateInput,
  ): Promise<AppSettingsDto> {
    return this.service.updateSettings(user, body);
  }
}
