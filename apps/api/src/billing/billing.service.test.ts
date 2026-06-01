import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@expertos/db";
import { BillingService } from "./billing.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type {
  BillingEvent,
  LedgerEntry,
  PaymentProvider,
  SubscriptionChange,
} from "./payment-provider";
import { WebhookVerificationError } from "./payment-provider";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

function makeTx() {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    planPrice: { findFirst: jest.fn() },
    subscription: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    transaction: { findUnique: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
  };
}

type Tx = ReturnType<typeof makeTx>;

function makeProvider(overrides: Partial<PaymentProvider> = {}): jest.Mocked<PaymentProvider> {
  return {
    name: "offline",
    createCheckoutSession: jest.fn(),
    openCustomerPortal: jest.fn(),
    verifyWebhook: jest.fn(),
    parseEvent: jest.fn(),
    cancelSubscription: jest.fn(),
    ...overrides,
  } as jest.Mocked<PaymentProvider>;
}

function makeService(tx: Tx, provider: jest.Mocked<PaymentProvider>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const prisma = {
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as ConstructorParameters<typeof BillingService>[2];
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
  const service = new BillingService(provider, rls, prisma, logger);
  return { service, run, logger };
}

const SUB_PLUS: SubscriptionChange = {
  kind: "subscription",
  eventId: "evt_1",
  providerCustomerId: "cus_1",
  providerSubscriptionId: "sub_1",
  providerPriceId: "price_plus",
  interval: "month",
  status: "active",
  currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
  cancelAt: null,
  canceledAt: null,
  clientReferenceId: USER.id,
};

describe("BillingService.createCheckout", () => {
  it("resolves the price, reuses the customer, and returns the hosted URL", async () => {
    const tx = makeTx();
    tx.planPrice.findFirst.mockResolvedValue({ providerPriceId: "price_plus" });
    tx.subscription.findFirst.mockResolvedValue({ providerCustomerId: "cus_1" });
    const provider = makeProvider({
      createCheckoutSession: jest.fn().mockResolvedValue({ url: "https://checkout" }),
    });
    const { service } = makeService(tx, provider);

    const result = await service.createCheckout(USER, { planKey: "plus", interval: "month" });

    expect(result).toEqual({ url: "https://checkout" });
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: "price_plus",
        clientReferenceId: USER.id,
        customerEmail: USER.email,
        customerId: "cus_1",
      }),
    );
  });

  it("omits customerId when the user has no prior provider customer", async () => {
    const tx = makeTx();
    tx.planPrice.findFirst.mockResolvedValue({ providerPriceId: "price_plus" });
    tx.subscription.findFirst.mockResolvedValue(null);
    const provider = makeProvider({
      createCheckoutSession: jest.fn().mockResolvedValue({ url: "https://checkout" }),
    });
    const { service } = makeService(tx, provider);

    await service.createCheckout(USER, { planKey: "plus", interval: "month" });

    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: undefined }),
    );
  });

  it("throws 400 when no purchasable price is configured for the plan", async () => {
    const tx = makeTx();
    tx.planPrice.findFirst.mockResolvedValue(null);
    const provider = makeProvider();
    const { service } = makeService(tx, provider);

    await expect(
      service.createCheckout(USER, { planKey: "ghost", interval: "month" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("throws 400 when the price row exists but has no provider price id", async () => {
    const tx = makeTx();
    tx.planPrice.findFirst.mockResolvedValue({ providerPriceId: null });
    const provider = makeProvider();
    const { service } = makeService(tx, provider);

    await expect(
      service.createCheckout(USER, { planKey: "plus", interval: "month" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("BillingService.createPortal", () => {
  it("returns the portal URL for the user's customer", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue({ providerCustomerId: "cus_1" });
    const provider = makeProvider({
      openCustomerPortal: jest.fn().mockResolvedValue({ url: "https://portal" }),
    });
    const { service } = makeService(tx, provider);

    const result = await service.createPortal(USER);

    expect(result).toEqual({ url: "https://portal" });
    expect(provider.openCustomerPortal).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_1" }),
    );
  });

  it("throws 400 when there is no billing account to manage", async () => {
    const tx = makeTx();
    tx.subscription.findFirst.mockResolvedValue(null);
    const provider = makeProvider();
    const { service } = makeService(tx, provider);

    await expect(service.createPortal(USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.openCustomerPortal).not.toHaveBeenCalled();
  });
});

describe("BillingService.handleWebhook — verification", () => {
  const req = { payload: Buffer.from("{}"), signature: "sig" };

  it("translates a WebhookVerificationError into a 400", async () => {
    const tx = makeTx();
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockRejectedValue(new WebhookVerificationError("bad sig")),
    });
    const { service } = makeService(tx, provider);

    await expect(service.handleWebhook(req)).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.parseEvent).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected verification error unchanged", async () => {
    const tx = makeTx();
    const boom = new Error("network down");
    const provider = makeProvider({ verifyWebhook: jest.fn().mockRejectedValue(boom) });
    const { service } = makeService(tx, provider);

    await expect(service.handleWebhook(req)).rejects.toBe(boom);
  });

  it("is a no-op for an unrecognized (null) event", async () => {
    const tx = makeTx();
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(null),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(req);

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });
});

/** Wires the provider to deliver a single parsed event for the webhook sync tests. */
function withEvent(tx: Tx, event: BillingEvent, name = "offline") {
  const provider = makeProvider({
    name,
    verifyWebhook: jest.fn().mockResolvedValue({}),
    parseEvent: jest.fn().mockReturnValue(event),
  });
  return makeService(tx, provider);
}

const REQ = { payload: Buffer.from("{}"), signature: "sig" };

describe("BillingService.handleWebhook — subscription sync", () => {
  it("creates a new subscription mapped to the checkout user", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.planPrice.findFirst.mockResolvedValue({ planId: "plan-plus", interval: "month" });
    tx.user.findUnique.mockResolvedValue({ tenantId: USER.tenantId });
    const { service } = withEvent(tx, SUB_PLUS);

    await service.handleWebhook(REQ);

    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: USER.tenantId,
        userId: USER.id,
        planId: "plan-plus",
        interval: "month",
        status: "active",
        providerCustomerId: "cus_1",
        providerSubId: "sub_1",
      }),
    });
  });

  it("updates an existing subscription (keeps its user) and applies the new plan/interval", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue({
      id: "row-1",
      userId: USER.id,
      tenantId: USER.tenantId,
    });
    tx.planPrice.findFirst.mockResolvedValue({ planId: "plan-premium", interval: "year" });
    const event: SubscriptionChange = {
      ...SUB_PLUS,
      providerPriceId: "price_premium",
      interval: "year",
      clientReferenceId: null,
    };
    const { service } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        status: "active",
        planId: "plan-premium",
        interval: "year",
      }),
    });
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });

  it("updates status only when the price is no longer mapped (e.g. cancellation)", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue({
      id: "row-1",
      userId: USER.id,
      tenantId: USER.tenantId,
    });
    tx.planPrice.findFirst.mockResolvedValue(null);
    const event: SubscriptionChange = {
      ...SUB_PLUS,
      providerPriceId: null,
      interval: null,
      status: "canceled",
      canceledAt: new Date("2026-07-01T00:00:00Z"),
      clientReferenceId: null,
    };
    const { service } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    const data = tx.subscription.update.mock.calls[0][0].data;
    expect(data.status).toBe("canceled");
    expect(data).not.toHaveProperty("planId");
    expect(data).not.toHaveProperty("interval");
  });

  it("skips (warns) when no user can be resolved for a new subscription", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue(null);
    const event: SubscriptionChange = { ...SUB_PLUS, clientReferenceId: null };
    const { service, logger } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips (warns) a brand-new subscription on an unmapped price", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.planPrice.findFirst.mockResolvedValue(null);
    const event: SubscriptionChange = { ...SUB_PLUS, providerPriceId: "price_unknown" };
    const { service, logger } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips (warns) when the mapped user no longer exists", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.planPrice.findFirst.mockResolvedValue({ planId: "plan-plus", interval: "month" });
    tx.user.findUnique.mockResolvedValue(null);
    const { service, logger } = withEvent(tx, SUB_PLUS);

    await service.handleWebhook(REQ);

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falls back to a monthly interval when neither the event nor the price provides one", async () => {
    const tx = makeTx();
    tx.subscription.findUnique.mockResolvedValue(null);
    // resolved price has no interval field → create must default to month.
    tx.planPrice.findFirst.mockResolvedValue({ planId: "plan-plus", interval: undefined });
    tx.user.findUnique.mockResolvedValue({ tenantId: USER.tenantId });
    const event: SubscriptionChange = { ...SUB_PLUS, interval: null };
    const { service } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    expect(tx.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ interval: "month" }),
    });
  });
});

const PAID: LedgerEntry = {
  kind: "transaction",
  eventId: "evt_inv",
  providerRef: "evt_inv",
  providerCustomerId: "cus_1",
  amountCents: 499,
  currency: "usd",
  type: "subscription",
  status: "succeeded",
};

describe("BillingService.handleWebhook — ledger sync", () => {
  it("appends a transaction resolved to the customer's user/tenant", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue(null);
    tx.subscription.findFirst.mockResolvedValue({ userId: USER.id, tenantId: USER.tenantId });
    const { service } = withEvent(tx, PAID, "stripe");

    await service.handleWebhook(REQ);

    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: USER.tenantId,
        userId: USER.id,
        amountCents: 499,
        currency: "usd",
        type: "subscription",
        status: "succeeded",
        provider: "stripe",
        providerRef: "evt_inv",
      }),
    });
  });

  it("records the transaction with no user when the customer is unknown", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue(null);
    const event: LedgerEntry = { ...PAID, providerCustomerId: null };
    const { service } = withEvent(tx, event);

    await service.handleWebhook(REQ);

    const data = tx.transaction.create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.tenantId).toBe("00000000-0000-0000-0000-000000000000");
    expect(tx.subscription.findFirst).not.toHaveBeenCalled();
  });

  it("records the transaction with no user when the customer has no subscription yet", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue(null);
    tx.subscription.findFirst.mockResolvedValue(null);
    const { service } = withEvent(tx, PAID);

    await service.handleWebhook(REQ);

    const data = tx.transaction.create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
  });

  it("is idempotent: a redelivered event already in the ledger is a no-op", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue({ id: "existing" });
    const { service } = withEvent(tx, PAID);

    await service.handleWebhook(REQ);

    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("swallows a P2002 unique-violation race as idempotent", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue(null);
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.transaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const { service } = withEvent(tx, PAID);

    await expect(service.handleWebhook(REQ)).resolves.toBeUndefined();
  });

  it("rethrows a non-unique database error", async () => {
    const tx = makeTx();
    tx.transaction.findUnique.mockResolvedValue(null);
    tx.subscription.findFirst.mockResolvedValue(null);
    const boom = new Prisma.PrismaClientKnownRequestError("nope", {
      code: "P2000",
      clientVersion: "test",
    });
    tx.transaction.create.mockRejectedValue(boom);
    const { service } = withEvent(tx, PAID);

    await expect(service.handleWebhook(REQ)).rejects.toBe(boom);
  });
});
