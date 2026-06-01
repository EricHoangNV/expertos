import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PAYMENT_PROVIDER } from "./billing.tokens";
import { createDefaultPaymentProvider } from "./billing.defaults";

/**
 * Wires billing (M6.2). `AuthModule` supplies {@link RlsService} (the checkout/portal RLS boundary);
 * `PrismaClient`/`StructuredLogger` come from the global database/observability modules. The
 * {@link PaymentProvider} comes from an offline-default factory behind the `PAYMENT_PROVIDER` token
 * (production swaps the Stripe driver in one place when its secrets are set). {@link BillingService}
 * is exported for the M8.3 revenue reports / reconciliation queries to reuse.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    { provide: PAYMENT_PROVIDER, useFactory: createDefaultPaymentProvider },
  ],
  exports: [BillingService],
})
export class BillingModule {}
