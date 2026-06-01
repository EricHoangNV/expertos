import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { EntitlementService } from "./entitlement.service";
import { EntitlementGuard } from "./entitlement.guard";
import { EntitlementsController } from "./entitlements.controller";

/**
 * Wires entitlement enforcement (M6.1). {@link EntitlementGuard} is registered as a global guard —
 * it runs after the auth guards from {@link AuthModule} (imported here for {@link RlsService}), and
 * is a no-op on routes without `@RequiresEntitlement`. The service is exported for direct use by
 * other modules (e.g. metered consumption outside a route in M6.3).
 */
@Module({
  imports: [AuthModule],
  controllers: [EntitlementsController],
  providers: [
    EntitlementService,
    { provide: APP_GUARD, useClass: EntitlementGuard },
  ],
  exports: [EntitlementService],
})
export class EntitlementsModule {}
