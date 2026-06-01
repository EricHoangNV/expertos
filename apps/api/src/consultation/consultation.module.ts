import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConsultationRecommendationsController } from "./consultation-recommendations.controller";
import { ConsultationBookingsController } from "./consultation-bookings.controller";
import { RecommendationRulesController } from "./recommendation-rules.controller";
import { RecommendationService } from "./recommendation.service";
import { RecommendationRulesService } from "./recommendation-rules.service";
import { BookingService } from "./booking.service";
import { TIDYCAL_PROVIDER } from "./tidycal.tokens";
import { createDefaultTidyCalProvider } from "./tidycal.defaults";

/**
 * Wires the M7 consultation funnel. M7.1 ships the {@link RecommendationService} — the rule-based
 * in-chat recommendation engine — consumed by {@link ChatModule} on the terminal `done` event of a
 * chat turn. M7.2 adds {@link ConsultationRecommendationsController}: the Book / Maybe later / Ask
 * another response endpoint + TidyCal booking. M7.3 adds {@link BookingService} +
 * {@link ConsultationBookingsController}: the TidyCal webhook that confirms a booking + admin
 * missed-event reconcile (Open Decision #10). M8.3 adds {@link RecommendationRulesController} +
 * {@link RecommendationRulesService}: the admin editor over the `recommendation_rules` config table,
 * so the funnel triggers are tunable with no deploy. The {@link TidyCalProvider} comes from an offline-default
 * factory behind the `TIDYCAL_PROVIDER` token (production swaps the real driver in one place when its
 * secret is set — the billing `PAYMENT_PROVIDER` pattern). `AuthModule` supplies {@link RlsService};
 * `PrismaClient`/{@link StructuredLogger} come from the global database/observability modules.
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
    { provide: TIDYCAL_PROVIDER, useFactory: createDefaultTidyCalProvider },
  ],
  exports: [RecommendationService, BookingService],
})
export class ConsultationModule {}
