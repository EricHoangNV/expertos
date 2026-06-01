import {
  OfflinePaymentProvider,
  parseOfflineEvent,
} from "./offline-payment-provider";
import { WebhookVerificationError } from "./payment-provider";

const provider = new OfflinePaymentProvider();

describe("OfflinePaymentProvider sessions", () => {
  it("returns an offline checkout URL carrying the price + reference", async () => {
    const session = await provider.createCheckoutSession({
      priceId: "price_1",
      clientReferenceId: "user-1",
      customerEmail: "u@x.io",
      successUrl: "s",
      cancelUrl: "c",
    });
    expect(session.url).toContain("offline://checkout");
    expect(session.url).toContain("price=price_1");
    expect(session.url).toContain("ref=user-1");
  });

  it("returns an offline portal URL carrying the customer", async () => {
    const session = await provider.openCustomerPortal({ customerId: "cus_1", returnUrl: "r" });
    expect(session.url).toContain("offline://portal");
    expect(session.url).toContain("customer=cus_1");
  });

  it("cancelSubscription is a no-op", async () => {
    await expect(provider.cancelSubscription("sub_1")).resolves.toBeUndefined();
  });
});

describe("OfflinePaymentProvider.verifyWebhook", () => {
  it("returns the parsed JSON for a well-formed payload", async () => {
    const out = await provider.verifyWebhook({
      payload: Buffer.from(JSON.stringify({ kind: "transaction" })),
      signature: undefined,
    });
    expect(out).toEqual({ kind: "transaction" });
  });

  it("throws on malformed JSON", async () => {
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("not json"), signature: undefined }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});

describe("parseOfflineEvent", () => {
  it("returns null for a non-object", () => {
    expect(parseOfflineEvent("nope")).toBeNull();
    expect(parseOfflineEvent(null)).toBeNull();
  });

  it("returns null for an unknown kind", () => {
    expect(parseOfflineEvent({ kind: "mystery" })).toBeNull();
  });

  it("parses a subscription event with dates coerced", () => {
    const event = parseOfflineEvent({
      id: "evt_1",
      kind: "subscription",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      providerPriceId: "price_1",
      interval: "year",
      status: "active",
      currentPeriodEnd: "2026-07-01T00:00:00Z",
      cancelAt: null,
      canceledAt: null,
      clientReferenceId: "user-1",
    });
    expect(event).toMatchObject({
      kind: "subscription",
      eventId: "evt_1",
      providerSubscriptionId: "sub_1",
      providerPriceId: "price_1",
      interval: "year",
      status: "active",
      clientReferenceId: "user-1",
    });
    expect((event as { currentPeriodEnd: Date }).currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("nulls optional subscription fields when absent or wrong-typed", () => {
    const event = parseOfflineEvent({
      kind: "subscription",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      status: "active",
      interval: "decade",
      currentPeriodEnd: 123,
    });
    expect(event).toMatchObject({
      eventId: "",
      providerPriceId: null,
      interval: null,
      clientReferenceId: null,
      cancelAt: null,
    });
    expect((event as { currentPeriodEnd: Date }).currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("returns null for a subscription event missing required fields", () => {
    expect(parseOfflineEvent({ kind: "subscription", providerCustomerId: "cus_1" })).toBeNull();
  });

  it("parses a transaction event and defaults currency", () => {
    const event = parseOfflineEvent({
      id: "evt_2",
      kind: "transaction",
      amountCents: 999,
      type: "subscription",
      status: "succeeded",
    });
    expect(event).toEqual({
      kind: "transaction",
      eventId: "evt_2",
      providerRef: "evt_2",
      providerCustomerId: null,
      amountCents: 999,
      currency: "usd",
      type: "subscription",
      status: "succeeded",
    });
  });

  it("returns null for a transaction event missing required fields", () => {
    expect(parseOfflineEvent({ kind: "transaction", type: "refund" })).toBeNull();
  });
});
