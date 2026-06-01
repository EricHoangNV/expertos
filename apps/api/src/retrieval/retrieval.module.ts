import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CacheModule } from "../cache/cache.module";
import { createDefaultEmbeddingProvider } from "../ingestion/ingestion.defaults";
import { RetrievalService } from "./retrieval.service";
import { RETRIEVAL_EMBEDDING_PROVIDER } from "./retrieval.tokens";

/**
 * Wires M1.2 hybrid retrieval. The embedding provider is created from the same factory the
 * ingestion pipeline uses ({@link createDefaultEmbeddingProvider}) so query and chunk
 * vectors share one model/space; production swaps that factory once and both sides follow.
 *
 * `AuthModule` supplies {@link RlsService}; `UsageLogService` / `StructuredLogger` come
 * from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule, CacheModule],
  providers: [
    RetrievalService,
    {
      provide: RETRIEVAL_EMBEDDING_PROVIDER,
      useFactory: createDefaultEmbeddingProvider,
    },
  ],
  exports: [RetrievalService],
})
export class RetrievalModule {}
