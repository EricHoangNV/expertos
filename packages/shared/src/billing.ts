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

/** One purchasable price for a plan — a billing interval and its amount. */
export interface PlanPriceDto {
  interval: "month" | "year";
  /** Price in the smallest currency unit (cents), as stored in `plan_prices.amount_cents`. */
  amountCents: number;
  currency: string;
}

/** A plan the acting user can upgrade to (a tier above their current plan that has a price). */
export interface UpgradePlanDto {
  key: string;
  name: string;
  /** Available billing intervals, cheapest first. Always non-empty (unpriced plans are omitted). */
  prices: PlanPriceDto[];
}

/**
 * `GET /me/plans` (M6.2 self-serve upgrade) — the purchasable plans above the acting user's current
 * tier, plus whether they already hold a paid plan (so the customer-portal "Manage billing" action
 * applies). Powers the consumer-web upgrade CTA: the account page renders one checkout button per
 * upgrade/interval and a portal button when `hasActiveSubscription`.
 */
export interface AvailablePlansDto {
  currentPlanKey: string;
  /** True when the user is on a paid plan, so the customer portal applies. */
  hasActiveSubscription: boolean;
  /** Higher tiers the user can buy, lowest first; empty when already on the top plan. */
  upgrades: UpgradePlanDto[];
}
