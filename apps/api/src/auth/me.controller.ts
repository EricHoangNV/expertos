import { Controller, Get, Post } from "@nestjs/common";
import type { AdminSessionDto } from "@expertos/shared";
import { CurrentUser } from "./current-user.decorator";
import { Roles } from "./roles.decorator";
import { AdminSessionService } from "./admin-session.service";
import type { AuthUser } from "./auth.types";

/** Returns the authenticated principal — the front-end uses it to hydrate session state. */
@Controller("me")
export class MeController {
  constructor(private readonly adminSession: AdminSessionService) {}

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

  /**
   * Admin-portal sign-in gate (M14). No `@Roles` — a freshly whitelisted admin's DB role may still
   * be `user` on first sign-in (chicken-and-egg), so the whitelist check itself is the gate. Returns
   * the synced session for a whitelisted email; throws 403 otherwise (→ portal Access Denied).
   */
  @Post("admin-session")
  adminSessionResolve(@CurrentUser() user: AuthUser): Promise<AdminSessionDto> {
    return this.adminSession.resolve(user);
  }
}
