import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, GLOBAL_TENANT_ID, type PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import { BetaGateService } from "./beta-gate.service";
import type { AuthUser, DecodedIdToken } from "./auth.types";

/**
 * Machine-readable error code for the private-beta 403, so the web client can distinguish
 * "not invited to the beta" from other 403s (e.g. RolesGuard) and render the invite screen.
 */
export const BETA_ACCESS_DENIED = "BETA_ACCESS_DENIED";

/**
 * Resolves a verified token into the local {@link AuthUser}, creating the user row
 * on first sign-in (Firebase is the identity source of truth; we mirror a row for
 * tenancy, role, and foreign keys).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly betaGate: BetaGateService,
  ) {}

  /**
   * Find-or-create the user for a verified token. Runs under an admin/system RLS
   * context: at sign-in the tenant is not yet known, and `firebase_uid` is globally
   * unique, so this lookup must not be tenant-scoped. New users land in the GLOBAL
   * tenant with the default `user` role.
   *
   * Private beta: when the gate is on, a `user`-roled account must have an
   * `allowed_emails` entry (any role — a fresh portal invite whose DB role is still
   * `user` passes via row existence) or every request 403s with
   * {@link BETA_ACCESS_DENIED}. `expert`/`admin` accounts skip the lookup: their role
   * is write-through-synced from the whitelist (`AccessControlService.syncUserRole`)
   * and defensively revoked at portal sign-in, so an elevated role implies membership.
   * The throw rolls the transaction back, so a denied first-time sign-in leaves no
   * user row behind — whitelisting the email later mirrors it cleanly on next request.
   */
  async resolveUser(token: DecodedIdToken): Promise<AuthUser> {
    // Read the gate flag BEFORE opening the transaction: `isEnabled()` queries through the global
    // client on a cache miss, and a cold read (fresh pool connection through the Cloud SQL proxy)
    // can take seconds — awaited inside the interactive transaction it would blow Prisma's 5s
    // transaction timeout and 500 the request.
    const gateEnabled = await this.betaGate.isEnabled();
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });

      const existing = await tx.user.findUnique({
        where: { firebaseUid: token.uid },
      });
      const user =
        existing ??
        (await tx.user.create({
          data: {
            firebaseUid: token.uid,
            email: token.email ?? "",
            displayName: token.name ?? null,
          },
        }));

      if (user.role === "user" && gateEnabled) {
        const email = user.email.trim().toLowerCase();
        const entry = await tx.allowedEmail.findUnique({
          where: { tenantId_email: { tenantId: GLOBAL_TENANT_ID, email } },
          select: { id: true },
        });
        if (!entry) {
          throw new ForbiddenException({
            message: "ExpertOS is in private beta. Your email is not on the invite list.",
            code: BETA_ACCESS_DENIED,
          });
        }
      }

      return {
        id: user.id,
        tenantId: user.tenantId,
        firebaseUid: user.firebaseUid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        locale: user.locale,
      };
    });
  }
}
