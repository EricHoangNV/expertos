import { Controller, Get } from "@nestjs/common";
import type { EntitlementsDto } from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { EntitlementService } from "./entitlement.service";

/**
 * `GET /me/entitlements` (M6.1, PRD §"Paywall, Entitlements & Feature Gating") — returns the acting
 * user's plan plus every feature's access / remaining metered quota, so the frontend usage indicator
 * can show the wall before it is hit. Shares the `/me` base path with {@link MeController}.
 */
@Controller("me")
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get("entitlements")
  getEntitlements(@CurrentUser() user: AuthUser): Promise<EntitlementsDto> {
    return this.entitlements.getEntitlements(user);
  }
}
