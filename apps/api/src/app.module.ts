import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { EntitlementsModule } from "./entitlements/entitlements.module";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { IngestionModule } from "./ingestion/ingestion.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { ObservabilityModule } from "./observability/observability.module";
import { RetrievalModule } from "./retrieval/retrieval.module";
import { VoiceModule } from "./voice/voice.module";
import { ChatModule } from "./chat/chat.module";
import { UploadModule } from "./uploads/upload.module";
import { BillingModule } from "./billing/billing.module";
import { RevenueModule } from "./revenue/revenue.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { FeedbackInspectorModule } from "./feedback-inspector/feedback-inspector.module";
import { AdminModule } from "./admin/admin.module";
import { ExpertModule } from "./expert/expert.module";
import { RateLimitModule } from "./rate-limit/rate-limit.module";

@Module({
  imports: [
    // First so its global guard throttles a burst before the auth guards verify a token (M11.2).
    RateLimitModule,
    DatabaseModule,
    AuthModule,
    EntitlementsModule,
    ObservabilityModule,
    IngestionModule,
    KnowledgeModule,
    RetrievalModule,
    VoiceModule,
    ChatModule,
    UploadModule,
    BillingModule,
    RevenueModule,
    AnalyticsModule,
    FeedbackInspectorModule,
    AdminModule,
    ExpertModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
