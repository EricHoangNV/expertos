import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { IngestionModule } from "./ingestion/ingestion.module";
import { ObservabilityModule } from "./observability/observability.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { VoiceModule } from "./voice/voice.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ObservabilityModule,
    IngestionModule,
    RetrievalModule,
    VoiceModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
