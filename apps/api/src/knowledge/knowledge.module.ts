import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";

/**
 * Wires the M8.1 admin/expert knowledge publish workflow ({@link KnowledgeService} +
 * {@link KnowledgeController}): the versioned-publish + expert-review gate over the draft
 * versions the M1.1 ingestion pipeline produces. `AuthModule` supplies {@link RlsService};
 * {@link StructuredLogger} comes from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
