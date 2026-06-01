import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RecommendationService } from "./recommendation.service";

/**
 * Wires the M7 consultation funnel. M7.1 ships the {@link RecommendationService} — the rule-based
 * in-chat recommendation engine — consumed by {@link ChatModule} on the terminal `done` event of a
 * chat turn. `AuthModule` supplies {@link RlsService}; {@link StructuredLogger} comes from the
 * global `ObservabilityModule`. The booking integration + response endpoints land in M7.2.
 */
@Module({
  imports: [AuthModule],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class ConsultationModule {}
