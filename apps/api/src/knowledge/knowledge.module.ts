import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IngestionModule } from "../ingestion/ingestion.module";
import { CacheModule } from "../cache/cache.module";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeDraftService } from "./knowledge-draft.service";
import { KnowledgeDraftController } from "./knowledge-draft.controller";

/**
 * Wires the admin/expert knowledge publish workflows:
 *  - M8.1 {@link KnowledgeService}: the versioned-publish + expert-review gate over the draft
 *    document versions the M1.1 ingestion pipeline produces (uploaded files).
 *  - M8.2 {@link KnowledgeDraftService}: the conversation-to-knowledge pipeline — capture a
 *    valuable answer as a free-text draft and, on publish, ingest it via {@link IngestionModule}.
 *
 * `AuthModule` supplies {@link RlsService}; `IngestionModule` supplies the publish-on-approve
 * ingestion path; `CacheModule` supplies {@link ResponseCacheService} for publish-time cache
 * invalidation; {@link StructuredLogger} comes from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule, IngestionModule, CacheModule],
  controllers: [KnowledgeController, KnowledgeDraftController],
  providers: [KnowledgeService, KnowledgeDraftService],
  exports: [KnowledgeService, KnowledgeDraftService],
})
export class KnowledgeModule {}
