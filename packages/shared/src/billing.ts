import { z } from "zod";

/**
 * Billing / checkout contract (M6.2, PRD §"Paywall, Entitlements & Feature Gating").
 *
 * The wire shapes the consumer app uses to start a hosted checkout or open the customer portal.
 * The redirect targets (success/cancel/return URLs) are chosen **server-side** from configuration,
 * never accepted from the client, so the hosted-payment flow can't be turned into an open redirect.
 * Tenant/user isolation is enforced by Postgres RLS (directive §4.21); no `tenant_id`/`user_id`
 * appears here.
 */

/**
 * Request body for `POST /billing/checkout`. Names a plan (admin-configurable, so a free-form key
 * bounded by length rather than a closed enum) and a billing interval; the API resolves these to the
 * payment provider's price ID via the `plan_prices` matrix.
 */
export const billingCheckoutSchema = z.object({
  /** The target plan key (e.g. `plus`, `premium`). Validated against the DB at checkout time. */
  planKey: z.string().trim().min(1).max(50),
  /** Monthly or annual billing. Premium offers both; defaults to monthly. */
  interval: z.enum(["month", "year"]).default("month"),
});

export type BillingCheckoutInput = z.infer<typeof billingCheckoutSchema>;

/** The hosted-checkout redirect target returned by `POST /billing/checkout`. */
export interface CheckoutSessionDto {
  /** Provider-hosted checkout URL the client redirects the user to. */
  url: string;
}

/** The customer-portal redirect target returned by `POST /billing/portal`. */
export interface PortalSessionDto {
  /** Provider-hosted billing-portal URL for managing/canceling the subscription. */
  url: string;
}
