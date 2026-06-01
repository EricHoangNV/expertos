import {
  type BillingEvent,
  type CheckoutSession,
  type CheckoutSessionInput,
  type LedgerEntry,
  type PaymentProvider,
  type PortalSession,
  type PortalSessionInput,
  type SubscriptionChange,
  WebhookVerificationError,
  type WebhookRequest,
} from "./payment-provider";

/**
 * Offline, in-process payment provider — the analog of `EchoLlmProvider` / `InMemoryStorageProvider`
 * so the entire billing path (checkout → webhook → subscription/ledger sync) runs deterministically
 * without Stripe or network. Used in local dev and tests; production swaps {@link StripePaymentProvider}
 * behind the `PAYMENT_PROVIDER` token.
 *
 * - Checkout / portal return `offline://…` URLs (no real redirect).
 * - Webhooks carry a **trusted JSON {@link BillingEvent} envelope** (there is no signing offline); a
 *   local script or test posts one to `/billing/webhook` to drive the same DB-sync code Stripe would.
 */
export class OfflinePaymentProvider implements PaymentProvider {
  readonly name = "offline";

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const params = new URLSearchParams({
      price: input.priceId,
      ref: input.clientReferenceId,
    });
    return { url: `offline://checkout?${params.toString()}` };
  }

  async openCustomerPortal(input: PortalSessionInput): Promise<PortalSession> {
    const params = new URLSearchParams({ customer: input.customerId });
    return { url: `offline://portal?${params.toString()}` };
  }

  async verifyWebhook(req: WebhookRequest): Promise<unknown> {
    // No signature scheme offline; the payload is trusted JSON (local/dev/test only).
    try {
      return JSON.parse(req.payload.toString("utf8"));
    } catch {
      throw new WebhookVerificationError("Malformed offline webhook payload");
    }
  }

  parseEvent(rawEvent: unknown): BillingEvent | null {
    return parseOfflineEvent(rawEvent);
  }

  async cancelSubscription(_providerSubscriptionId: string): Promise<void> {
    // No-op offline — there is no external subscription to cancel.
  }
}

/**
 * Validates the offline webhook envelope into a {@link BillingEvent}. The envelope *is* the normalized
 * event (with ISO date strings), so this only type-checks and coerces dates. Anything unrecognized →
 * `null` (ignored), matching the Stripe driver's "unknown event type → null" behavior.
 */
export function parseOfflineEvent(raw: unknown): BillingEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const e = raw as Record<string, unknown>;
  const eventId = typeof e.id === "string" ? e.id : "";

  if (e.kind === "subscription") {
    if (
      typeof e.providerCustomerId !== "string" ||
      typeof e.providerSubscriptionId !== "string" ||
      typeof e.status !== "string"
    ) {
      return null;
    }
    const change: SubscriptionChange = {
      kind: "subscription",
      eventId,
      providerCustomerId: e.providerCustomerId,
      providerSubscriptionId: e.providerSubscriptionId,
      providerPriceId: typeof e.providerPriceId === "string" ? e.providerPriceId : null,
      interval: e.interval === "month" || e.interval === "year" ? e.interval : null,
      status: e.status as SubscriptionChange["status"],
      currentPeriodEnd: toDate(e.currentPeriodEnd),
      cancelAt: toDate(e.cancelAt),
      canceledAt: toDate(e.canceledAt),
      clientReferenceId:
        typeof e.clientReferenceId === "string" ? e.clientReferenceId : null,
    };
    return change;
  }

  if (e.kind === "transaction") {
    if (
      typeof e.amountCents !== "number" ||
      typeof e.type !== "string" ||
      typeof e.status !== "string"
    ) {
      return null;
    }
    const entry: LedgerEntry = {
      kind: "transaction",
      eventId,
      providerRef: eventId,
      providerCustomerId:
        typeof e.providerCustomerId === "string" ? e.providerCustomerId : null,
      amountCents: e.amountCents,
      currency: typeof e.currency === "string" ? e.currency : "usd",
      type: e.type as LedgerEntry["type"],
      status: e.status as LedgerEntry["status"],
    };
    return entry;
  }

  return null;
}

/** Coerces an ISO date string (or epoch ms number) to a Date; anything else → null. */
function toDate(value: unknown): Date | null {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
