import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FailedQueryService } from "./failed-query.service";
import { FailedQueryController } from "./failed-query.controller";

/**
 * Wires the admin failed / low-confidence query inspector (M8.3). `AuthModule` supplies
 * {@link RlsService} (the admin cross-tenant RLS boundary); `PrismaClient` comes from the global
 * database module. Read-only — it only aggregates the `answer_feedback` rows users left.
 */
@Module({
  imports: [AuthModule],
  controllers: [FailedQueryController],
  providers: [FailedQueryService],
})
export class FeedbackInspectorModule {}
