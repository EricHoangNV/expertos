import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import {
  entitlementUpdateSchema,
  type EntitlementCellDto,
  type EntitlementMatrixDto,
  type EntitlementUpdateInput,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { EntitlementMatrixService } from "./entitlement-matrix.service";

/**
 * Admin plan-entitlement matrix editor API (M8.3). Admin-only (`@Roles("admin")`); cells are global
 * config so a change is platform-wide. The only **mutation** surface of M8.3 — branchy validation
 * lives in {@link EntitlementMatrixService} (the coverage gate collects `*.service.ts`); this
 * controller validates the body and pins identity from the path so it can't be reassigned.
 */
@Controller("admin/entitlements")
@Roles("admin")
export class EntitlementAdminController {
  constructor(private readonly service: EntitlementMatrixService) {}

  /** The full plan × feature matrix with each populated entitlement cell. */
  @Get()
  getMatrix(@CurrentUser() user: AuthUser): Promise<EntitlementMatrixDto> {
    return this.service.getMatrix(user);
  }

  /** Save one (plan, feature) cell. Identity comes from the path, the value from the body. */
  @Patch(":planId/features/:featureId")
  updateCell(
    @CurrentUser() user: AuthUser,
    @Param("planId", ParseUUIDPipe) planId: string,
    @Param("featureId", ParseUUIDPipe) featureId: string,
    @Body(new ZodValidationPipe(entitlementUpdateSchema)) body: EntitlementUpdateInput,
  ): Promise<EntitlementCellDto> {
    return this.service.updateCell(user, planId, featureId, body);
  }
}
