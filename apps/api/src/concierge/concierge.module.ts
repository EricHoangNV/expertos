import { Module } from "@nestjs/common";
import { createDefaultEmbeddingProvider } from "../ingestion/ingestion.defaults";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { EmailModule } from "../email/email.module";
import { ConciergeConfigController } from "./concierge-config.controller";
import { ConciergeConfigService } from "./concierge-config.service";
import { ConciergeQueueService } from "./concierge-queue.service";
import { ConciergeReviewService } from "./concierge-review.service";
import { ConciergeReviewController } from "./concierge-review.controller";
import { ConciergeFlywheelService } from "./concierge-flywheel.service";
import { ConciergeDeliveryService } from "./concierge-delivery.service";
import {
  CONCIERGE_ALLOW_SILENT,
  CONCIERGE_EMBEDDING_PROVIDER,
  resolveSilentReviewAllowed,
} from "./concierge.tokens";

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
 * M9.4 adds {@link ConciergeFlywheelService} (invoked by {@link ConciergeReviewService} after a verdict:
 * great/edited → knowledge draft + voice example, bad → source-chunk flagging) + escalate-to-consultation
 * (on the review service). The flywheel embeds captured voice examples with the same model as voice
 * retrieval ({@link CONCIERGE_EMBEDDING_PROVIDER}).
 *
 * M9.3 adds {@link ConciergeDeliveryService} (invoked by {@link ConciergeReviewService} after a verdict:
 * an *edited* answer is pushed back into the conversation as a "refined update" + the user is emailed —
 * "visible update vs silent"). It sends through the {@link EmailModule} transactional-email seam.
 *
 * `AuthModule` supplies the auth guards/decorators (the queue services run elevated reads via the
 * global `PrismaClient`, like the expert portal); `AdminModule` exports {@link AdminAuditService} (the
 * audit sink the config editor writes through); `EmailModule` supplies the {@link EmailService} the
 * async delivery notification sends through.
 */
@Module({
  imports: [AuthModule, AdminModule, EmailModule],
  controllers: [ConciergeConfigController, ConciergeReviewController],
  providers: [
    ConciergeConfigService,
    ConciergeQueueService,
    ConciergeReviewService,
    ConciergeFlywheelService,
    ConciergeDeliveryService,
    { provide: CONCIERGE_ALLOW_SILENT, useFactory: resolveSilentReviewAllowed },
    { provide: CONCIERGE_EMBEDDING_PROVIDER, useFactory: createDefaultEmbeddingProvider },
  ],
  exports: [ConciergeQueueService],
})
export class ConciergeModule {}
