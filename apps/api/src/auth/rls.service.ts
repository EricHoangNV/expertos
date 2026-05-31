import { Inject, Injectable } from "@nestjs/common";
import { applyRlsContext, type Prisma, type PrismaClient } from "@expertos/db";
import { PRISMA } from "../database/database.module";
import type { AuthUser } from "./auth.types";

/**
 * Runs request DB work inside a transaction scoped to the acting user's RLS
 * context. This is the structural isolation choke point (directive §4.21): every
 * query inside `work` is automatically scoped to the user's tenant/user — no query
 * needs to remember a `WHERE tenant_id = …` clause.
 *
 * Admin-role users get the `is_admin` GUC (cross-tenant/user visibility) so the
 * admin + expert portals can operate across the tenant.
 */
@Injectable()
export class RlsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  run<T>(
    user: AuthUser,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        isAdmin: user.role === "admin",
      });
      return work(tx);
    });
  }
}
