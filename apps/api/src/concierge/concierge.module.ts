import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { ConciergeConfigController } from "./concierge-config.controller";
import { ConciergeConfigService } from "./concierge-config.service";
import { CONCIERGE_ALLOW_SILENT, resolveSilentReviewAllowed } from "./concierge.tokens";

/**
 * Wires Concierge Mode (M9, PRD §"Concierge Mode"). M9.1 ships the admin trigger-config editor
 * ({@link ConciergeConfigController} + {@link ConciergeConfigService}) over the `review_configs` global
 * singleton — the human-review safety net (Off / Mode A / Mode B), confidence threshold, SLA, and
 * volume cap, tunable with no deploy. The OD#5 legal gate on Mode B (silent review) is the injected
 * {@link CONCIERGE_ALLOW_SILENT} boolean, resolved once at boot from the environment.
 *
 * `AuthModule` supplies {@link RlsService}; `AdminModule` exports {@link AdminAuditService} (the shared
 * audit sink every admin mutation writes through). The remaining M9 slices (review queue, async
 * delivery, reviewer-feedback flywheel) build on this module once OD#5 is resolved.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [ConciergeConfigController],
  providers: [
    ConciergeConfigService,
    { provide: CONCIERGE_ALLOW_SILENT, useFactory: resolveSilentReviewAllowed },
  ],
})
export class ConciergeModule {}
