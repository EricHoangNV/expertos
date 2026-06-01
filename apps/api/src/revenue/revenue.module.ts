import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RevenueService } from "./revenue.service";
import { RevenueController } from "./revenue.controller";

/**
 * Wires admin revenue reporting (M8.3). `AuthModule` supplies {@link RlsService} (the admin
 * cross-tenant RLS boundary); `PrismaClient` comes from the global database module. Read-only —
 * no provider integration; revenue is mirrored into `subscriptions`/`transactions` by the M6.2
 * {@link BillingService} webhook path, and this module only aggregates it.
 */
@Module({
  imports: [AuthModule],
  controllers: [RevenueController],
  providers: [RevenueService],
})
export class RevenueModule {}
