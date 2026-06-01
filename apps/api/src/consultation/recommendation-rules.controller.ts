import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import {
  recommendationRuleUpdateSchema,
  recommendationTriggerSchema,
  type RecommendationRuleDto,
  type RecommendationRuleUpdateInput,
  type RecommendationRulesDto,
  type RecommendationTriggerValue,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RecommendationRulesService } from "./recommendation-rules.service";

/**
 * Admin recommendation-rules editor API (M8.3). Admin-only (`@Roles("admin")`); rules are global
 * config so a change is platform-wide. A **mutation** surface of M8.3 (alongside the entitlement
 * matrix) — branchy validation lives in {@link RecommendationRulesService} (the coverage gate
 * collects `*.service.ts`); this controller validates the body, pins identity (the trigger) from the
 * path so it can't be reassigned, and rejects an unknown trigger via the enum schema.
 */
@Controller("admin/recommendation-rules")
@Roles("admin")
export class RecommendationRulesController {
  constructor(private readonly service: RecommendationRulesService) {}

  /** Every configured rule plus the consultation types a rule can point at. */
  @Get()
  getRules(@CurrentUser() user: AuthUser): Promise<RecommendationRulesDto> {
    return this.service.getRules(user);
  }

  /** Save one rule. The trigger (identity) comes from the path, the value from the body. */
  @Patch(":trigger")
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param("trigger", new ZodValidationPipe(recommendationTriggerSchema))
    trigger: RecommendationTriggerValue,
    @Body(new ZodValidationPipe(recommendationRuleUpdateSchema)) body: RecommendationRuleUpdateInput,
  ): Promise<RecommendationRuleDto> {
    return this.service.updateRule(user, trigger, body);
  }
}
