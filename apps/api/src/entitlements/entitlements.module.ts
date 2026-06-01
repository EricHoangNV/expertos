import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { EntitlementService } from "./entitlement.service";
import { EntitlementMatrixService } from "./entitlement-matrix.service";
import { EntitlementGuard } from "./entitlement.guard";
import { EntitlementsController } from "./entitlements.controller";
import { EntitlementAdminController } from "./entitlement-admin.controller";

/**
 * Wires entitlement enforcement (M6.1) + the admin matrix editor (M8.3). {@link EntitlementGuard} is
 * registered as a global guard — it runs after the auth guards from {@link AuthModule} (imported here
 * for {@link RlsService}), and is a no-op on routes without `@RequiresEntitlement`. The
 * {@link EntitlementMatrixService} is the admin write path over the same `plan_entitlements` matrix
 * the enforcement reads. The enforcement service is exported for direct use by other modules.
 */
@Module({
  imports: [AuthModule],
  controllers: [EntitlementsController, EntitlementAdminController],
  providers: [
    EntitlementService,
    EntitlementMatrixService,
    { provide: APP_GUARD, useClass: EntitlementGuard },
  ],
  exports: [EntitlementService],
})
export class EntitlementsModule {}
