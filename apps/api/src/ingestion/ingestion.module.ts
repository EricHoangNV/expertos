import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IngestionService } from "./ingestion.service";
import { DocumentVersionRepository } from "./document-version.repository";
import {
  createDefaultEmbeddingProvider,
  createDefaultParserRegistry,
  createDefaultSummarizer,
} from "./ingestion.defaults";
import {
  EMBEDDING_PROVIDER,
  PARSER_REGISTRY,
  SUMMARIZER,
} from "./ingestion.tokens";

/**
 * Wires the M1.1 ingestion pipeline. Defaults are offline/deterministic (shared with
 * the seed/CLI loader via {@link ingestion.defaults}) so loading and tests run without
 * network or API keys; production overrides {@link EMBEDDING_PROVIDER} / {@link SUMMARIZER}
 * behind the same tokens with the real OpenAI/LLM drivers.
 *
 * `AuthModule` is imported for {@link RlsService} (it is not `@Global`); `UsageLogService`
 * and `StructuredLogger` come from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  providers: [
    IngestionService,
    DocumentVersionRepository,
    { provide: PARSER_REGISTRY, useFactory: createDefaultParserRegistry },
    { provide: EMBEDDING_PROVIDER, useFactory: createDefaultEmbeddingProvider },
    { provide: SUMMARIZER, useFactory: createDefaultSummarizer },
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
