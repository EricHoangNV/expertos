import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "./current-user.decorator";
import { Roles } from "./roles.decorator";
import type { AuthUser } from "./auth.types";

/** Returns the authenticated principal — the front-end uses it to hydrate session state. */
@Controller("me")
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /**
   * Admin access check — the admin/expert portal calls this to gate the portal
   * behind the `admin` role (returns 403 otherwise). Demonstrates the `@Roles`
   * RBAC guard end-to-end.
   */
  @Get("admin")
  @Roles("admin")
  adminAccess(@CurrentUser() user: AuthUser): { ok: true; role: AuthUser["role"] } {
    return { ok: true, role: user.role };
  }
}
