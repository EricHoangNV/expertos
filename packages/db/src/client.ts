import { PrismaClient } from "../generated/client";

/**
 * Process-wide PrismaClient singleton.
 *
 * Cached on `globalThis` so dev hot-reload / repeated imports don't open a new
 * connection pool each time. The application connects as the non-superuser
 * `app_user` role (see the RLS migration) so Row-Level Security is enforced;
 * per-request tenant/user scoping is applied with {@link applyRlsContext}.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
