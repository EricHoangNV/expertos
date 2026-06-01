import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";

/**
 * Wires admin usage & cost analytics (M10.1). `AuthModule` supplies {@link RlsService} (the admin
 * cross-tenant RLS boundary); `PrismaClient` comes from the global database module. Read-only — it
 * only aggregates the `usage_logs` ledger written by {@link UsageLogService} (P0.5 / M6.5).
 */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
