import { createHmac } from "node:crypto";
import {
  StripePaymentProvider,
  parseStripeSignatureHeader,
  type StripeHttpClient,
} from "./stripe-payment-provider";
import { WebhookVerificationError } from "./payment-provider";

const WEBHOOK_SECRET = "whsec_test";
const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

/** Builds a valid `stripe-signature` header for `payload` at timestamp `t`. */
function sign(payload: string, t = NOW_S): string {
  const sig = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${t}.${payload}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${sig}`;
}

function makeProvider(httpClient?: StripeHttpClient) {
  return new StripePaymentProvider({
    secretKey: "sk_test",
    webhookSecret: WEBHOOK_SECRET,
    httpClient,
    now: () => NOW_MS,
  });
}

/** A recording fake transport so REST param construction is asserted without network. */
function makeHttp(response: Record<string, unknown> = { url: "https://stripe" }) {
  const calls: Array<{ method: string; path: string; form?: Record<string, string> }> = [];
  const http: StripeHttpClient = {
    request: jest.fn(async (method, path, form) => {
      calls.push({ method, path, form });
      return response;
    }),
  };
  return { http, calls };
}

describe("parseStripeSignatureHeader", () => {
  it("parses timestamp and one or more v1 signatures", () => {
    expect(parseStripeSignatureHeader("t=123,v1=aaa,v1=bbb")).toEqual({
      timestamp: 123,
      signatures: ["aaa", "bbb"],
    });
  });

  it("returns null when the header is missing, has no timestamp, or no v1", () => {
    expect(parseStripeSignatureHeader(undefined)).toBeNull();
    expect(parseStripeSignatureHeader("v1=aaa")).toBeNull();
    expect(parseStripeSignatureHeader("t=123")).toBeNull();
    expect(parseStripeSignatureHeader("t=notanumber,v1=aaa")).toBeNull();
  });
});

describe("StripePaymentProvider.verifyWebhook", () => {
  it("returns the parsed event for a valid signature", async () => {
    const provider = makeProvider();
    const payload = JSON.stringify({ id: "evt_1", type: "noop" });
    const out = await provider.verifyWebhook({
      payload: Buffer.from(payload),
      signature: sign(payload),
    });
    expect(out).toEqual({ id: "evt_1", type: "noop" });
  });

  it("rejects a missing/malformed signature header", async () => {
    const provider = makeProvider();
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("{}"), signature: undefined }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects a signature that does not match the body", async () => {
    const provider = makeProvider();
    const header = sign("the original body");
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("a tampered body"), signature: header }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects a timestamp outside the tolerance window (replay)", async () => {
    const provider = makeProvider();
    const payload = "{}";
    const stale = sign(payload, NOW_S - 10_000);
    await expect(
      provider.verifyWebhook({ payload: Buffer.from(payload), signature: stale }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it("rejects a verified-signature body that is not JSON", async () => {
    const provider = makeProvider();
    const payload = "not json";
    await expect(
      provider.verifyWebhook({ payload: Buffer.from(payload), signature: sign(payload) }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("StripePaymentProvider.parseEvent", () => {
  const provider = makeProvider();

  it("returns null for a non-object or a missing data.object", () => {
    expect(provider.parseEvent("nope")).toBeNull();
    expect(provider.parseEvent({ id: "evt", type: "customer.subscription.updated" })).toBeNull();
  });

  it("returns null for an unhandled event type", () => {
    expect(
      provider.parseEvent({ id: "evt", type: "customer.created", data: { object: {} } }),
    ).toBeNull();
  });

  it("maps customer.subscription.updated with price, interval, metadata and periods", () => {
    const event = provider.parseEvent({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          current_period_end: NOW_S,
          cancel_at: null,
          canceled_at: null,
          metadata: { userId: "user-1" },
          items: { data: [{ price: { id: "price_1", recurring: { interval: "year" } } }] },
        },
      },
    });
    expect(event).toMatchObject({
      kind: "subscription",
      eventId: "evt_1",
      providerSubscriptionId: "sub_1",
      providerCustomerId: "cus_1",
      providerPriceId: "price_1",
      interval: "year",
      status: "active",
      clientReferenceId: "user-1",
    });
    expect((event as { currentPeriodEnd: Date }).currentPeriodEnd).toEqual(new Date(NOW_S * 1000));
  });

  it("forces canceled status for a subscription.deleted event", () => {
    const event = provider.parseEvent({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1", status: "active", items: { data: [] } } },
    });
    expect(event).toMatchObject({
      kind: "subscription",
      status: "canceled",
      providerPriceId: null,
      interval: null,
      clientReferenceId: null,
    });
  });

  it("returns null when the subscription object lacks id or customer", () => {
    expect(
      provider.parseEvent({
        id: "e",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_1" } },
      }),
    ).toBeNull();
  });

  it("maps invoice.payment_succeeded to a succeeded ledger entry keyed by event id", () => {
    const event = provider.parseEvent({
      id: "evt_inv",
      type: "invoice.payment_succeeded",
      data: { object: { customer: "cus_1", amount_paid: 499, currency: "usd" } },
    });
    expect(event).toEqual({
      kind: "transaction",
      eventId: "evt_inv",
      providerRef: "evt_inv",
      providerCustomerId: "cus_1",
      amountCents: 499,
      currency: "usd",
      type: "subscription",
      status: "succeeded",
    });
  });

  it("maps invoice.payment_failed to a failed entry using amount_due", () => {
    const event = provider.parseEvent({
      id: "evt_f",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_1", amount_due: 999, currency: "usd" } },
    });
    expect(event).toMatchObject({ type: "subscription", status: "failed", amountCents: 999 });
  });

  it("maps charge.refunded to a refund entry, defaulting amount/currency when absent", () => {
    const event = provider.parseEvent({
      id: "evt_r",
      type: "charge.refunded",
      data: { object: {} },
    });
    expect(event).toMatchObject({
      type: "refund",
      status: "refunded",
      amountCents: 0,
      currency: "usd",
      providerCustomerId: null,
    });
  });
});

describe("StripePaymentProvider REST calls", () => {
  it("builds a checkout session with line item, metadata, and customer_email (no prior customer)", async () => {
    const { http, calls } = makeHttp({ url: "https://checkout" });
    const provider = makeProvider(http);

    const session = await provider.createCheckoutSession({
      priceId: "price_1",
      clientReferenceId: "user-1",
      customerEmail: "u@x.io",
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });

    expect(session).toEqual({ url: "https://checkout" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/checkout/sessions" });
    expect(calls[0].form).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_1",
      client_reference_id: "user-1",
      "subscription_data[metadata][userId]": "user-1",
      customer_email: "u@x.io",
    });
    expect(calls[0].form).not.toHaveProperty("customer");
  });

  it("reuses an existing customer instead of email when provided", async () => {
    const { http, calls } = makeHttp({ url: "https://checkout" });
    const provider = makeProvider(http);

    await provider.createCheckoutSession({
      priceId: "price_1",
      clientReferenceId: "user-1",
      customerEmail: "u@x.io",
      customerId: "cus_9",
      successUrl: "s",
      cancelUrl: "c",
    });

    expect(calls[0].form).toMatchObject({ customer: "cus_9" });
    expect(calls[0].form).not.toHaveProperty("customer_email");
  });

  it("throws when the checkout response has no url", async () => {
    const provider = makeProvider(makeHttp({}).http);
    await expect(
      provider.createCheckoutSession({
        priceId: "p",
        clientReferenceId: "u",
        customerEmail: "e",
        successUrl: "s",
        cancelUrl: "c",
      }),
    ).rejects.toThrow(/no url/);
  });

  it("opens a customer portal session", async () => {
    const { http, calls } = makeHttp({ url: "https://portal" });
    const provider = makeProvider(http);

    const session = await provider.openCustomerPortal({ customerId: "cus_1", returnUrl: "https://app" });

    expect(session).toEqual({ url: "https://portal" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/billing_portal/sessions",
      form: { customer: "cus_1", return_url: "https://app" },
    });
  });

  it("throws when the portal response has no url", async () => {
    const provider = makeProvider(makeHttp({}).http);
    await expect(
      provider.openCustomerPortal({ customerId: "cus_1", returnUrl: "r" }),
    ).rejects.toThrow(/no url/);
  });

  it("cancels a subscription via DELETE", async () => {
    const { http, calls } = makeHttp({ id: "sub_1" });
    const provider = makeProvider(http);

    await provider.cancelSubscription("sub_1");

    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/subscriptions/sub_1" });
  });
});
