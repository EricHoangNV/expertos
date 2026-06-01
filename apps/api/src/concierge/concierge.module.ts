import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { ConciergeConfigController } from "./concierge-config.controller";
import { ConciergeConfigService } from "./concierge-config.service";
import { ConciergeQueueService } from "./concierge-queue.service";
import { ConciergeReviewService } from "./concierge-review.service";
import { ConciergeReviewController } from "./concierge-review.controller";
import { CONCIERGE_ALLOW_SILENT, resolveSilentReviewAllowed } from "./concierge.tokens";

/**
 * Wires Concierge Mode (M9, PRD §"Concierge Mode").
 *
 * M9.1 ships the admin trigger-config editor ({@link ConciergeConfigController} +
 * {@link ConciergeConfigService}) over the `review_configs` global singleton — the human-review safety
 * net (Off / Mode A / Mode B), confidence threshold, SLA, and volume cap, tunable with no deploy. The
 * OD#5 legal gate on Mode B (silent review) is the injected {@link CONCIERGE_ALLOW_SILENT} boolean.
 *
 * M9.2 adds the queue: {@link ConciergeQueueService} (the enqueue seam {@link ChatService} calls after
 * a low-confidence Mode B turn — exported for that consumer) and {@link ConciergeReviewService} +
 * {@link ConciergeReviewController} (the `@Roles("expert")` reviewer queue + verdict/edit, voice-scoped
 * via the M8.5 elevated-but-bounded RLS pattern).
 *
 * `AuthModule` supplies the auth guards/decorators (the queue services run elevated reads via the
 * global `PrismaClient`, like the expert portal); `AdminModule` exports {@link AdminAuditService} (the
 * audit sink the config editor writes through). Async delivery + the reviewer-feedback flywheel (M9.3/
 * M9.4) build on this module.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [ConciergeConfigController, ConciergeReviewController],
  providers: [
    ConciergeConfigService,
    ConciergeQueueService,
    ConciergeReviewService,
    { provide: CONCIERGE_ALLOW_SILENT, useFactory: resolveSilentReviewAllowed },
  ],
  exports: [ConciergeQueueService],
})
export class ConciergeModule {}
