import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsultationRecommendationsController } from "./consultation-recommendations.controller";
import { RecommendationService } from "./recommendation.service";

/**
 * Wires the M7 consultation funnel. M7.1 ships the {@link RecommendationService} — the rule-based
 * in-chat recommendation engine — consumed by {@link ChatModule} on the terminal `done` event of a
 * chat turn. M7.2 adds {@link ConsultationRecommendationsController}: the Book / Maybe later / Ask
 * another response endpoint + TidyCal booking. `AuthModule` supplies {@link RlsService};
 * {@link StructuredLogger} comes from the global `ObservabilityModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [ConsultationRecommendationsController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class ConsultationModule {}
