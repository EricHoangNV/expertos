import { createHmac, timingSafeEqual } from "node:crypto";
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
 * The HTTP transport for Stripe's REST API, declared structurally so this driver takes **no `stripe`
 * SDK dependency** (same pattern as the chat `SseResponse` / upload `MultipartFile`). The default
 * {@link FetchStripeHttpClient} uses the global `fetch`; a test injects a fake to assert the request
 * params without a network call.
 */
export interface StripeHttpClient {
  /** Issue a form-encoded request to a Stripe API `path` (e.g. `/checkout/sessions`). */
  request(
    method: "POST" | "DELETE",
    path: string,
    form?: Record<string, string>,
  ): Promise<Record<string, unknown>>;
}

interface StripePaymentProviderOptions {
  secretKey: string;
  webhookSecret: string;
  /** Swappable transport (defaults to a `fetch`-based client over `https://api.stripe.com/v1`). */
  httpClient?: StripeHttpClient;
  /** Injectable clock for signature-timestamp tolerance (tests pin it). */
  now?: () => number;
  /** Max age (seconds) of a webhook timestamp before it is rejected as a possible replay. */
  toleranceSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Stripe driver (Phase-1's only real {@link PaymentProvider}). The security-critical, network-free
 * parts — webhook **signature verification** (HMAC-SHA256 over the raw body, Stripe's documented
 * scheme) and **event parsing** — are implemented directly with `node:crypto` and are exhaustively
 * unit-tested. Checkout / portal / cancel issue Stripe REST calls through the injected
 * {@link StripeHttpClient}; the default transport needs live network (verified at deploy, not in CI),
 * but this driver builds the request params deterministically so that logic stays testable.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly http: StripeHttpClient;
  private readonly webhookSecret: string;
  private readonly now: () => number;
  private readonly toleranceSeconds: number;

  constructor(opts: StripePaymentProviderOptions) {
    this.webhookSecret = opts.webhookSecret;
    this.http = opts.httpClient ?? new FetchStripeHttpClient(opts.secretKey);
    this.now = opts.now ?? (() => Date.now());
    this.toleranceSeconds = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const form: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      // Stamp our user id onto the subscription so its lifecycle webhooks can map back to the user.
      "subscription_data[metadata][userId]": input.clientReferenceId,
    };
    if (input.customerId) {
      form.customer = input.customerId;
    } else {
      form.customer_email = input.customerEmail;
    }
    const res = await this.http.request("POST", "/checkout/sessions", form);
    const url = res.url;
    if (typeof url !== "string") {
      throw new Error("Stripe checkout session response had no url");
    }
    return { url };
  }

  async openCustomerPortal(input: PortalSessionInput): Promise<PortalSession> {
    const res = await this.http.request("POST", "/billing_portal/sessions", {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    const url = res.url;
    if (typeof url !== "string") {
      throw new Error("Stripe portal session response had no url");
    }
    return { url };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.http.request(
      "DELETE",
      `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
    );
  }

  async verifyWebhook(req: WebhookRequest): Promise<unknown> {
    const parsed = parseStripeSignatureHeader(req.signature);
    if (!parsed) {
      throw new WebhookVerificationError("Missing or malformed stripe-signature header");
    }

    // Reject a stale timestamp (replay window) before the constant-time compare.
    const ageSeconds = Math.abs(Math.floor(this.now() / 1000) - parsed.timestamp);
    if (ageSeconds > this.toleranceSeconds) {
      throw new WebhookVerificationError("Webhook timestamp outside tolerance");
    }

    const signedPayload = `${parsed.timestamp}.${req.payload.toString("utf8")}`;
    const expected = createHmac("sha256", this.webhookSecret)
      .update(signedPayload, "utf8")
      .digest("hex");

    // Any provided v1 signature matching the expected HMAC verifies the delivery (Stripe may send
    // several during a secret rotation). Constant-time compare to avoid a timing side channel.
    const matches = parsed.signatures.some((sig) => safeEqualHex(sig, expected));
    if (!matches) {
      throw new WebhookVerificationError("Webhook signature does not match");
    }

    try {
      return JSON.parse(req.payload.toString("utf8"));
    } catch {
      throw new WebhookVerificationError("Webhook body is not valid JSON");
    }
  }

  parseEvent(rawEvent: unknown): BillingEvent | null {
    if (typeof rawEvent !== "object" || rawEvent === null) {
      return null;
    }
    const event = rawEvent as Record<string, unknown>;
    const eventId = typeof event.id === "string" ? event.id : "";
    const type = typeof event.type === "string" ? event.type : "";
    const object = isRecord(event.data) ? event.data.object : undefined;
    if (!isRecord(object)) {
      return null;
    }

    switch (type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return toSubscriptionChange(eventId, type, object);
      case "invoice.payment_succeeded":
        return toLedgerEntry(eventId, object, "subscription", "succeeded", "amount_paid");
      case "invoice.payment_failed":
        return toLedgerEntry(eventId, object, "subscription", "failed", "amount_due");
      case "charge.refunded":
        return toLedgerEntry(eventId, object, "refund", "refunded", "amount_refunded");
      default:
        return null;
    }
  }
}

/** A parsed `stripe-signature` header: the timestamp and any number of v1 HMAC signatures. */
interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/** Parses Stripe's `t=…,v1=…[,v1=…]` signature header. Returns null if no timestamp or v1 part. */
export function parseStripeSignatureHeader(
  header: string | undefined,
): ParsedSignatureHeader | null {
  if (!header) {
    return null;
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t" && value) {
      const t = Number(value);
      if (Number.isInteger(t)) {
        timestamp = t;
      }
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) {
    return null;
  }
  return { timestamp, signatures };
}

/** Constant-time hex-string comparison (guards against a timing side channel). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSubscriptionChange(
  eventId: string,
  type: string,
  sub: Record<string, unknown>,
): SubscriptionChange | null {
  const providerSubscriptionId = typeof sub.id === "string" ? sub.id : null;
  const providerCustomerId = typeof sub.customer === "string" ? sub.customer : null;
  if (!providerSubscriptionId || !providerCustomerId) {
    return null;
  }

  const item = firstSubscriptionItem(sub);
  const price = item && isRecord(item.price) ? item.price : undefined;
  const providerPriceId = price && typeof price.id === "string" ? price.id : null;
  const recurring = price && isRecord(price.recurring) ? price.recurring : undefined;
  const interval =
    recurring && (recurring.interval === "month" || recurring.interval === "year")
      ? recurring.interval
      : null;

  const metadata = isRecord(sub.metadata) ? sub.metadata : undefined;
  const clientReferenceId =
    metadata && typeof metadata.userId === "string" ? metadata.userId : null;

  // A `deleted` event always means canceled, regardless of the (often stale) `status` field.
  const status =
    type === "customer.subscription.deleted"
      ? "canceled"
      : ((typeof sub.status === "string" ? sub.status : "active") as SubscriptionChange["status"]);

  return {
    kind: "subscription",
    eventId,
    providerCustomerId,
    providerSubscriptionId,
    providerPriceId,
    interval,
    status,
    currentPeriodEnd: epochToDate(sub.current_period_end),
    cancelAt: epochToDate(sub.cancel_at),
    canceledAt: epochToDate(sub.canceled_at),
    clientReferenceId,
  };
}

function firstSubscriptionItem(
  sub: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const items = isRecord(sub.items) ? sub.items : undefined;
  const data = items && Array.isArray(items.data) ? items.data : undefined;
  const first = data?.[0];
  return isRecord(first) ? first : undefined;
}

function toLedgerEntry(
  eventId: string,
  object: Record<string, unknown>,
  type: LedgerEntry["type"],
  status: LedgerEntry["status"],
  amountField: string,
): LedgerEntry {
  const amount = object[amountField];
  const currency = object.currency;
  return {
    kind: "transaction",
    eventId,
    providerRef: eventId,
    providerCustomerId: typeof object.customer === "string" ? object.customer : null,
    amountCents: typeof amount === "number" ? amount : 0,
    currency: typeof currency === "string" ? currency : "usd",
    type,
    status,
  };
}

/** Stripe sends timestamps as Unix epoch **seconds**; convert to a Date (null when absent). */
function epochToDate(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

/**
 * Default Stripe transport: form-encoded calls to `https://api.stripe.com/v1` with the secret key as
 * HTTP Basic username. Needs live network, so it is exercised at deploy time, not in CI (the M11
 * Testcontainers/integration caveat, same as the GCS storage driver).
 */
class FetchStripeHttpClient implements StripeHttpClient {
  private static readonly BASE_URL = "https://api.stripe.com/v1";

  constructor(private readonly secretKey: string) {}

  async request(
    method: "POST" | "DELETE",
    path: string,
    form?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const auth = Buffer.from(`${this.secretKey}:`).toString("base64");
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    if (form) {
      init.body = new URLSearchParams(form).toString();
    }
    const res = await fetch(`${FetchStripeHttpClient.BASE_URL}${path}`, init);
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Stripe API ${method} ${path} failed with ${res.status}`);
    }
    return body;
  }
}
