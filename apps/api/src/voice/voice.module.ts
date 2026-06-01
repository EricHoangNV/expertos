import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { createDefaultEmbeddingProvider } from "../ingestion/ingestion.defaults";
import { VoiceService } from "./voice.service";
import { VOICE_EMBEDDING_PROVIDER } from "./voice.tokens";

/**
 * Wires M2.1 runtime voice-example retrieval. The embedding provider comes from the same
 * factory ingestion + knowledge retrieval use ({@link createDefaultEmbeddingProvider}) so the
 * query topic and the stored voice-example vectors share one model/space.
 *
 * `AuthModule` supplies {@link RlsService}; `UsageLogService` / `StructuredLogger` come from
 * the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  providers: [
    VoiceService,
    {
      provide: VOICE_EMBEDDING_PROVIDER,
      useFactory: createDefaultEmbeddingProvider,
    },
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
