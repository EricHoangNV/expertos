import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuditController } from "./admin-audit.controller";
import { AdminUserService } from "./admin-user.service";
import { AdminUserController } from "./admin-user.controller";
import { AdminExpertService } from "./admin-expert.service";
import { AdminExpertController } from "./admin-expert.controller";

/**
 * Admin management portal (M8.4, PRD §"Admin web portal" + §"Foundational security/privacy"):
 * user / subscription / fair-use management, expert-roster management, the immutable admin audit
 * log, and user-data deletion. `AuthModule` supplies {@link RlsService} (the admin cross-tenant RLS
 * boundary); `StructuredLogger` comes from the global {@link ObservabilityModule}.
 * {@link AdminAuditService} is the shared audit sink every mutation writes through.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController, AdminUserController, AdminExpertController],
  providers: [AdminAuditService, AdminUserService, AdminExpertService],
  exports: [AdminAuditService],
})
export class AdminModule {}
