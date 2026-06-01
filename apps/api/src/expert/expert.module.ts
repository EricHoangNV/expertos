import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ExpertPortalService } from "./expert-portal.service";
import { ExpertPortalController } from "./expert-portal.controller";

/**
 * Wires the expert portal (M8.5). `AuthModule` supplies the auth guards + decorators; `PrismaClient`
 * comes from the global database module ({@link ExpertPortalService} runs its reads in an elevated
 * RLS context, so it injects `PRISMA` directly rather than the request-scoped `RlsService`).
 * Read-only — voice + knowledge approval reuse the existing M2.3 / M8.1 expert-scoped routes.
 */
@Module({
  imports: [AuthModule],
  controllers: [ExpertPortalController],
  providers: [ExpertPortalService],
})
export class ExpertModule {}
