import type {
  BillingInterval,
  SubscriptionStatus,
  TransactionStatus,
  TransactionType,
} from "@expertos/db";

/**
 * The payment-provider seam (M6.2, PRD §"Payment-provider abstraction"). **All billing goes through
 * this interface — no app code imports the Stripe SDK directly**, so swapping to Paddle / Lemon
 * Squeezy / PayPal later is a new driver, not a rewrite. The offline default
 * ({@link OfflinePaymentProvider}) keeps the whole checkout→webhook→ledger path runnable without
 * Stripe or network (mirroring the `EchoLlmProvider` / `InMemoryStorageProvider` pattern); the
 * Stripe driver swaps in behind the `PAYMENT_PROVIDER` token when its env secrets are present.
 *
 * The provider is the payment **source of truth**; {@link BillingService} mirrors every event into
 * our own `subscriptions` + `transactions` tables ({@link parseEvent} normalizes the provider's event
 * shape into {@link BillingEvent}) so reporting/reconciliation never depends on the provider dashboard
 * and survives a provider switch.
 */
export interface PaymentProvider {
  /** Stable driver name, recorded on `transactions.provider` (e.g. `stripe`, `offline`). */
  readonly name: string;

  /** Create a hosted checkout session; returns the URL the client redirects to. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;

  /** Create a customer-portal session for self-service manage/cancel; returns the URL. */
  openCustomerPortal(input: PortalSessionInput): Promise<PortalSession>;

  /**
   * Verify a webhook delivery's signature over the **raw** request bytes and return the provider's
   * event object. Throws {@link WebhookVerificationError} on a missing/invalid signature — the body
   * is attacker-reachable, so an unverified payload is never trusted.
   */
  verifyWebhook(req: WebhookRequest): Promise<unknown>;

  /**
   * Map a verified provider event onto our normalized {@link BillingEvent}, or `null` for an event
   * type we deliberately ignore. Pure — no IO — so it is exhaustively unit-testable.
   */
  parseEvent(rawEvent: unknown): BillingEvent | null;

  /** Cancel a subscription at the provider (e.g. an admin-initiated cancellation). */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}

/** Inputs for a hosted checkout session. Redirect URLs are server-chosen (never client-supplied). */
export interface CheckoutSessionInput {
  /** The provider price ID for the chosen plan + interval (from `plan_prices.provider_price_id`). */
  priceId: string;
  /** Our user id, echoed back on the resulting subscription so the webhook can map it to the user. */
  clientReferenceId: string;
  /** The user's email, prefilled on the hosted checkout. */
  customerEmail: string;
  /** Reuse an existing provider customer so a returning buyer isn't duplicated. */
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider-hosted checkout URL. */
  url: string;
}

export interface PortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface PortalSession {
  /** Provider-hosted billing-portal URL. */
  url: string;
}

export interface WebhookRequest {
  /** The exact raw request bytes — signature verification must run over the unparsed body. */
  payload: Buffer;
  /** The provider signature header value (Stripe's `stripe-signature`); may be absent. */
  signature: string | undefined;
}

/**
 * A subscription lifecycle change mirrored from a provider webhook. {@link BillingService} upserts a
 * `subscriptions` row keyed by `providerSubscriptionId` (so redelivered events are idempotent).
 */
export interface SubscriptionChange {
  kind: "subscription";
  /** Provider event id (for tracing / log correlation). */
  eventId: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  /** The price the subscription is on → resolves our plan + interval; `null` if not derivable. */
  providerPriceId: string | null;
  /** The interval the provider reports, if known (else derived from the resolved price). */
  interval: BillingInterval | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  canceledAt: Date | null;
  /**
   * Our user id, carried in the subscription metadata we set at checkout. Present so the webhook can
   * map a brand-new subscription to its user; `null` on later updates (then the existing row's user
   * is used).
   */
  clientReferenceId: string | null;
}

/**
 * A financial event appended to the revenue ledger (`transactions`). `providerRef` is the provider's
 * **event id** — unique per delivery and stable across retries — so the `[provider, providerRef]`
 * uniqueness makes ledger writes idempotent.
 */
export interface LedgerEntry {
  kind: "transaction";
  eventId: string;
  /** Idempotency key for the ledger row (= the provider event id). */
  providerRef: string;
  providerCustomerId: string | null;
  amountCents: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
}

export type BillingEvent = SubscriptionChange | LedgerEntry;

/**
 * Thrown by a driver's {@link PaymentProvider.verifyWebhook} when the signature is missing or does not
 * match. {@link BillingService} translates it into a `400` so an unverified webhook is rejected
 * (never silently trusted, never a `500`).
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
