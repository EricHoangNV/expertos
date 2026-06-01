import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { createDefaultEmbeddingProvider } from "../ingestion/ingestion.defaults";
import { VoiceService } from "./voice.service";
import { VoiceProfileService } from "./voice-profile.service";
import { VoiceProfileController } from "./voice-profile.controller";
import { ExpertsController } from "./experts.controller";
import { VOICE_EMBEDDING_PROVIDER } from "./voice.tokens";

/**
 * Wires M2.1 runtime voice-example retrieval and the M2.3 voice-profile authoring + sign-off
 * workflow ({@link VoiceProfileService} + {@link VoiceProfileController}). The embedding
 * provider comes from the same factory ingestion + knowledge retrieval use
 * ({@link createDefaultEmbeddingProvider}) so the query topic and the stored voice-example
 * vectors share one model/space.
 *
 * `AuthModule` supplies {@link RlsService}; `UsageLogService` / `StructuredLogger` come from
 * the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [VoiceProfileController, ExpertsController],
  providers: [
    VoiceService,
    VoiceProfileService,
    {
      provide: VOICE_EMBEDDING_PROVIDER,
      useFactory: createDefaultEmbeddingProvider,
    },
  ],
  exports: [VoiceService, VoiceProfileService],
})
export class VoiceModule {}
