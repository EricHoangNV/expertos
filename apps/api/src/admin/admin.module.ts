import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuditController } from "./admin-audit.controller";
import { AdminUserService } from "./admin-user.service";
import { AdminUserController } from "./admin-user.controller";

/**
 * Admin management portal (M8.4, PRD §"Admin web portal" + §"Foundational security/privacy"):
 * user / subscription / fair-use management, the immutable admin audit log, and user-data deletion.
 * `AuthModule` supplies {@link RlsService} (the admin cross-tenant RLS boundary); `StructuredLogger`
 * comes from the global {@link ObservabilityModule}. {@link AdminAuditService} is the shared audit
 * sink the user mutations write through.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController, AdminUserController],
  providers: [AdminAuditService, AdminUserService],
})
export class AdminModule {}
