import { Global, Module } from "@nestjs/common";
import { prisma } from "@expertos/db";

/**
 * DI token for the process-wide PrismaClient singleton (`@expertos/db`).
 *
 * The client connects as the non-superuser `app_user` role (DATABASE_URL), so
 * Row-Level Security is enforced; per-request scoping is applied with
 * {@link RlsService} (which calls `applyRlsContext` inside a transaction).
 */
export const PRISMA = "PRISMA";

@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class DatabaseModule {}
