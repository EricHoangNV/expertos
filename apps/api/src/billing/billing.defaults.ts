/**
 * Single source of truth for the M6.2 billing default. Mirrors `upload.defaults.ts` /
 * `ingestion.defaults.ts`: one factory the running API (and any future worker) share so they can't
 * drift on which payment driver they use.
 *
 * Resolves the real {@link StripePaymentProvider} when both `STRIPE_SECRET_KEY` and
 * `STRIPE_WEBHOOK_SECRET` are configured (out of band via Secret Manager — never in code/env files,
 * per PRD §"Security"); otherwise the offline default keeps the whole checkout→webhook→ledger path
 * runnable locally and in tests.
 */
import type { PaymentProvider } from "./payment-provider";
import { OfflinePaymentProvider } from "./offline-payment-provider";
import { StripePaymentProvider } from "./stripe-payment-provider";

export function createDefaultPaymentProvider(): PaymentProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secretKey && webhookSecret) {
    return new StripePaymentProvider({ secretKey, webhookSecret });
  }
  return new OfflinePaymentProvider();
}
