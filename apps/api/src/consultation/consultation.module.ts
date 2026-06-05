import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsultationRecommendationsController } from "./consultation-recommendations.controller";
import { ConsultationBookingsController } from "./consultation-bookings.controller";
import { RecommendationRulesController } from "./recommendation-rules.controller";
import { RecommendationService } from "./recommendation.service";
import { RecommendationRulesService } from "./recommendation-rules.service";
import { BookingService } from "./booking.service";
import { TidyCalProviderFactory } from "./tidycal-provider.factory";

/**
 * Wires the M7 consultation funnel. M7.1 ships the {@link RecommendationService} — the rule-based
 * in-chat recommendation engine — consumed by {@link ChatModule} on the terminal `done` event of a
 * chat turn. M7.2 adds {@link ConsultationRecommendationsController}: the Book / Maybe later / Ask
 * another response endpoint + TidyCal booking. M7.3 adds {@link BookingService} +
 * {@link ConsultationBookingsController}: the TidyCal webhook that confirms a booking + admin
 * missed-event reconcile (Open Decision #10). M8.3 adds {@link RecommendationRulesController} +
 * {@link RecommendationRulesService}: the admin editor over the `recommendation_rules` config table,
 * so the funnel triggers are tunable with no deploy. M16 reworks booking sync to **per-expert polling**
 * (TidyCal has no native webhooks): {@link TidyCalProviderFactory} resolves each expert's own
 * {@link TidyCalProvider} from their encrypted API token (env-global → offline fallback), replacing the
 * old process-wide singleton. `AuthModule` supplies {@link RlsService}; `PrismaClient`/{@link StructuredLogger}
 * come from the global database/observability modules.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    ConsultationRecommendationsController,
    ConsultationBookingsController,
    RecommendationRulesController,
  ],
  providers: [
    RecommendationService,
    RecommendationRulesService,
    BookingService,
    TidyCalProviderFactory,
  ],
  exports: [RecommendationService, BookingService],
})
export class ConsultationModule {}
