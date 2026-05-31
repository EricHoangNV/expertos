import { Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, GLOBAL_TENANT_ID, type PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import type { AuthUser, DecodedIdToken } from "./auth.types";

/**
 * Resolves a verified token into the local {@link AuthUser}, creating the user row
 * on first sign-in (Firebase is the identity source of truth; we mirror a row for
 * tenancy, role, and foreign keys).
 */
@Injectable()
export class AuthService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Find-or-create the user for a verified token. Runs under an admin/system RLS
   * context: at sign-in the tenant is not yet known, and `firebase_uid` is globally
   * unique, so this lookup must not be tenant-scoped. New users land in the GLOBAL
   * tenant with the default `user` role.
   */
  async resolveUser(token: DecodedIdToken): Promise<AuthUser> {
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
