import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, GLOBAL_TENANT_ID, type PrismaClient } from "@expertos/db";
import type { AdminSessionDto, AllowedEmailRole } from "@expertos/shared";
import { PRISMA } from "../database/database.module";
import type { AuthUser } from "./auth.types";

/**
 * The admin-portal sign-in gate (M14, PRD-access-control §5.2). The admin portal calls
 * `POST /me/admin-session` instead of `GET /me`; this service checks the whitelist and, when the
 * signed-in email is authorized, syncs the user's role to the whitelist entry (the whitelist is the
 * source of truth for portal roles). A non-whitelisted email gets a 403 → the portal renders its
 * Access Denied screen. The consumer app keeps calling `GET /me` and is completely unaffected.
 *
 * Like {@link AuthService.resolveUser}, this runs under a GLOBAL-tenant admin/system context rather
 * than {@link RlsService.run}: at sign-in the user's role may still be the default `user` (first
 * sign-in of a freshly whitelisted admin), so the lookup must not depend on the caller already being
 * an admin. The whitelist is GLOBAL-tenant-scoped today (single-tenant MVP).
 */
@Injectable()
export class AdminSessionService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Authorize a signed-in user against the whitelist, syncing their role; 403 if not whitelisted. */
  async resolve(user: AuthUser): Promise<AdminSessionDto> {
    const email = user.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });

      const entry = await tx.allowedEmail.findUnique({
        where: { tenantId_email: { tenantId: GLOBAL_TENANT_ID, email } },
        select: { role: true },
      });
      // Only the two portal roles authorize the portal; a `user`-roled row (shouldn't exist — the
      // app layer never writes one) is treated as not authorized, defensively.
      if (!entry || (entry.role !== "admin" && entry.role !== "expert")) {
        // Defense-in-depth: if this account still carries a stale elevated role (e.g. its whitelist
        // entry was removed out-of-band), revoke it now so RolesGuard can't authorize it from a
        // stale users.role. The primary revocation is the write-through in AccessControlService.
        if (user.role === "admin" || user.role === "expert") {
          await tx.user.update({ where: { id: user.id }, data: { role: "user" } });
        }
        throw new ForbiddenException("Your email is not authorized for the admin portal");
      }
      const role: AllowedEmailRole = entry.role;

      // Sync the DB role to the whitelist so a role change applies on next sign-in (PRD §5.4).
      if (user.role !== role) {
        await tx.user.update({ where: { id: user.id }, data: { role } });
      }

      return {
        ok: true,
        role,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      };
    });
  }
}
