import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@expertos/db";
import { BookingService } from "./booking.service";
import type { StructuredLogger } from "../observability/logger.service";
import {
  type BookingEvent,
  type BookingWebhookRequest,
  BookingWebhookVerificationError,
  type TidyCalProvider,
} from "./tidycal-provider";

const SCHEDULED_AT = new Date("2026-06-10T15:00:00.000Z");

const CREATED: BookingEvent = {
  eventId: "evt_1",
  eventType: "booking.created",
  bookingRef: "bkg_1",
  email: "u@expertos.local",
  scheduledAt: SCHEDULED_AT,
  status: "booked",
};

function makeTx() {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    bookingWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    consultation: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn() },
    // M16: reconcile resolves which experts to poll + advances their watermark.
    expert: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  };
}

type Tx = ReturnType<typeof makeTx>;

function makeProvider(overrides: Partial<TidyCalProvider> = {}): jest.Mocked<TidyCalProvider> {
  return {
    name: "tidycal",
    verifyWebhook: jest.fn(),
    parseEvent: jest.fn(),
    listBookings: jest.fn(),
    ...overrides,
  } as jest.Mocked<TidyCalProvider>;
}

/** A factory whose `default()`/`forExpert()` both return the one test provider. */
function makeFactory(provider: TidyCalProvider): ConstructorParameters<typeof BookingService>[0] {
  return {
    default: () => provider,
    forExpert: () => provider,
  } as unknown as ConstructorParameters<typeof BookingService>[0];
}

function makeService(tx: Tx, provider: jest.Mocked<TidyCalProvider>) {
  const prisma = {
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as ConstructorParameters<typeof BookingService>[1];
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  } as unknown as StructuredLogger;
  const service = new BookingService(makeFactory(provider), prisma, logger);
  return { service, logger };
}

const REQ: BookingWebhookRequest = { payload: Buffer.from("{}"), signature: "sig" };

describe("BookingService.handleWebhook", () => {
  it("translates a verification error into a 400", async () => {
    const tx = makeTx();
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockRejectedValue(new BookingWebhookVerificationError("bad sig")),
    });
    const { service } = makeService(tx, provider);
    await expect(service.handleWebhook(REQ)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses the offline (unsigned) webhook seam in production", async () => {
    const tx = makeTx();
    const provider = makeProvider({ verifyWebhook: jest.fn().mockResolvedValue({}) });
    (provider as { name: string }).name = "offline";
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const { service } = makeService(tx, provider);
      await expect(service.handleWebhook(REQ)).rejects.toBeInstanceOf(BadRequestException);
      expect(provider.verifyWebhook).not.toHaveBeenCalled();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("rethrows an unexpected verification failure (not a 400)", async () => {
    const tx = makeTx();
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const { service } = makeService(tx, provider);
    await expect(service.handleWebhook(REQ)).rejects.toThrow("boom");
  });

  it("is a no-op for an event type we don't model (parseEvent → null)", async () => {
    const tx = makeTx();
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(null),
    });
    const { service } = makeService(tx, provider);
    await service.handleWebhook(REQ);
    expect(tx.bookingWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("links an existing consultation found by bookingRef (a follow-up event)", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.update).toHaveBeenCalledWith({
      where: { id: "con_1" },
      data: { status: "booked", scheduledAt: SCHEDULED_AT },
    });
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.bookingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "tidycal",
          eventId: "evt_1",
          consultationId: "con_1",
          matched: true,
          payload: expect.objectContaining({ scheduledAt: SCHEDULED_AT.toISOString() }),
        }),
      }),
    );
  });

  it("leaves the prior scheduledAt untouched on a cancellation matched by bookingRef", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest
        .fn()
        .mockReturnValue({ ...CREATED, eventType: "booking.cancelled", status: "canceled", scheduledAt: null }),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.update).toHaveBeenCalledWith({
      where: { id: "con_1" },
      data: { status: "canceled", scheduledAt: undefined },
    });
  });

  it("flips the user's pending recommended consultation when none matches by bookingRef", async () => {
    const tx = makeTx();
    tx.consultation.findFirst
      .mockResolvedValueOnce(null) // by bookingRef
      .mockResolvedValueOnce({ id: "con_pending" }); // pending recommended
    tx.user.findFirst.mockResolvedValue({ id: "user_1", tenantId: "tenant_1" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { email: "u@expertos.local" },
      orderBy: { createdAt: "desc" },
      select: { id: true, tenantId: true },
    });
    expect(tx.consultation.update).toHaveBeenCalledWith({
      where: { id: "con_pending" },
      data: { status: "booked", bookingRef: "bkg_1", scheduledAt: SCHEDULED_AT },
    });
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("flips a pending consultation without overwriting its scheduledAt when the event has none", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "con_pending" });
    tx.user.findFirst.mockResolvedValue({ id: "user_1", tenantId: "tenant_1" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue({ ...CREATED, scheduledAt: null }),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.update).toHaveBeenCalledWith({
      where: { id: "con_pending" },
      data: { status: "booked", bookingRef: "bkg_1", scheduledAt: undefined },
    });
  });

  it("creates a new booked consultation for a booking made outside the funnel", async () => {
    const tx = makeTx();
    tx.consultation.findFirst
      .mockResolvedValueOnce(null) // by bookingRef
      .mockResolvedValueOnce(null); // no pending recommended
    tx.user.findFirst.mockResolvedValue({ id: "user_1", tenantId: "tenant_1" });
    tx.consultation.create.mockResolvedValue({ id: "con_new" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant_1",
        userId: "user_1",
        status: "booked",
        bookingRef: "bkg_1",
        scheduledAt: SCHEDULED_AT,
      },
      select: { id: true },
    });
    expect(tx.bookingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consultationId: "con_new", matched: true }) }),
    );
  });

  it("records an unmatched event (no user) without creating a consultation, and warns", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce(null); // by bookingRef
    tx.user.findFirst.mockResolvedValue(null); // email matches no user
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service, logger } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.create).not.toHaveBeenCalled();
    expect(tx.bookingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consultationId: null, matched: false }) }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not try to resolve a user when the event carries no email", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce(null);
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue({ ...CREATED, email: null, scheduledAt: null }),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.bookingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matched: false, scheduledAt: null, payload: expect.objectContaining({ scheduledAt: null }) }) }),
    );
  });

  it("is idempotent: a redelivered event already in the ledger is a no-op", async () => {
    const tx = makeTx();
    tx.bookingWebhookEvent.findUnique.mockResolvedValue({ id: "ledger_1" });
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await service.handleWebhook(REQ);

    expect(tx.consultation.findFirst).not.toHaveBeenCalled();
    expect(tx.bookingWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("swallows a P2002 race on the ledger insert (concurrent redelivery)", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    tx.bookingWebhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }),
    );
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await expect(service.handleWebhook(REQ)).resolves.toBeUndefined();
  });

  it("rethrows a non-unique error from the ledger insert", async () => {
    const tx = makeTx();
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    tx.bookingWebhookEvent.create.mockRejectedValue(new Error("db down"));
    const provider = makeProvider({
      verifyWebhook: jest.fn().mockResolvedValue({}),
      parseEvent: jest.fn().mockReturnValue(CREATED),
    });
    const { service } = makeService(tx, provider);

    await expect(service.handleWebhook(REQ)).rejects.toThrow("db down");
  });
});

describe("BookingService.reconcile", () => {
  /** Seed one configured expert so there is a target to poll. */
  function seedExpert(tx: Tx, overrides: Partial<{ id: string; tidycalPolledAt: Date | null }> = {}) {
    tx.expert.findMany.mockResolvedValue([
      {
        id: overrides.id ?? "exp_1",
        tidycalApiTokenEnc: "enc",
        tidycalPolledAt: overrides.tidycalPolledAt ?? null,
      },
    ]);
  }

  it("polls each configured expert with a default lookback and reports an empty poll", async () => {
    const tx = makeTx();
    seedExpert(tx);
    const provider = makeProvider({ listBookings: jest.fn().mockResolvedValue([]) });
    const { service, logger } = makeService(tx, provider);

    const result = await service.reconcile({});

    expect(provider.listBookings).toHaveBeenCalledWith({ since: expect.any(Date) });
    const sinceArg = provider.listBookings.mock.calls[0][0].since.getTime();
    expect(Date.now() - sinceArg).toBeGreaterThan(0); // a past timestamp
    expect(result).toEqual({ polled: 0, applied: 0, matched: 0, skipped: 0, failedTargets: 0 });
    expect(logger.info).not.toHaveBeenCalled();
    // The expert's watermark is advanced even on an empty poll.
    expect(tx.expert.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "exp_1" }, data: { tidycalPolledAt: expect.any(Date) } }),
    );
  });

  it("uses the expert's watermark as the poll `since` when no explicit since is given", async () => {
    const tx = makeTx();
    const watermark = new Date("2026-05-30T00:00:00.000Z");
    seedExpert(tx, { tidycalPolledAt: watermark });
    const provider = makeProvider({ listBookings: jest.fn().mockResolvedValue([]) });
    const { service } = makeService(tx, provider);

    await service.reconcile({});

    expect(provider.listBookings).toHaveBeenCalledWith({ since: watermark });
  });

  it("namespaces the synthetic eventId per expert (so two experts' ids can't collide)", async () => {
    const tx = makeTx();
    seedExpert(tx);
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    const event: BookingEvent = { ...CREATED, eventId: "reconcile:bkg_1:booking.created" };
    const provider = makeProvider({ listBookings: jest.fn().mockResolvedValue([event]) });
    const { service } = makeService(tx, provider);

    await service.reconcile({});

    expect(tx.bookingWebhookEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_eventId: { provider: "tidycal", eventId: "expert:exp_1:reconcile:bkg_1:booking.created" } },
      }),
    );
  });

  it("scopes the pending-consultation match to the polling expert and stamps attribution on create", async () => {
    const tx = makeTx();
    seedExpert(tx);
    tx.consultation.findFirst
      .mockResolvedValueOnce(null) // by bookingRef
      .mockResolvedValueOnce(null); // no pending recommended for this expert
    tx.user.findFirst.mockResolvedValue({ id: "user_1", tenantId: "tenant_1" });
    tx.consultation.create.mockResolvedValue({ id: "con_new" });
    const provider = makeProvider({ listBookings: jest.fn().mockResolvedValue([CREATED]) });
    const { service } = makeService(tx, provider);

    await service.reconcile({});

    // pending lookup is filtered to the expert
    expect(tx.consultation.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: "recommended", bookingRef: null, expertId: "exp_1" }),
      }),
    );
    // the created consultation is attributed to the expert
    expect(tx.consultation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expertId: "exp_1", bookingRef: "bkg_1" }) }),
    );
  });

  it("tallies matched / duplicate outcomes and logs when something applied", async () => {
    const tx = makeTx();
    seedExpert(tx);
    const matchedEvent: BookingEvent = { ...CREATED, eventId: "reconcile:bkg_1:booking.created" };
    const dupEvent: BookingEvent = { ...CREATED, eventId: "reconcile:bkg_2:booking.created", bookingRef: "bkg_2" };
    tx.bookingWebhookEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "seen" });
    tx.consultation.findFirst.mockResolvedValueOnce({ id: "con_1" });
    const provider = makeProvider({
      listBookings: jest.fn().mockResolvedValue([matchedEvent, dupEvent]),
    });
    const { service, logger } = makeService(tx, provider);
    const since = new Date("2026-06-01T00:00:00.000Z");

    const result = await service.reconcile({ since });

    expect(provider.listBookings).toHaveBeenCalledWith({ since });
    expect(result).toEqual({ polled: 2, applied: 1, matched: 1, skipped: 1, failedTargets: 0 });
    expect(logger.info).toHaveBeenCalled(); // applied > 0
  });

  it("counts an unmatched recovered booking as applied-but-not-matched", async () => {
    const tx = makeTx();
    seedExpert(tx);
    tx.consultation.findFirst.mockResolvedValueOnce(null);
    tx.user.findFirst.mockResolvedValue(null);
    const provider = makeProvider({
      listBookings: jest.fn().mockResolvedValue([CREATED]),
    });
    const { service } = makeService(tx, provider);

    const result = await service.reconcile({ since: new Date() });

    expect(result).toEqual({ polled: 1, applied: 1, matched: 0, skipped: 0, failedTargets: 0 });
  });

  it("falls back to a single default poll (env token) when no expert has a token", async () => {
    const tx = makeTx();
    tx.expert.findMany.mockResolvedValue([]); // no configured experts
    const prev = process.env.TIDYCAL_API_TOKEN;
    process.env.TIDYCAL_API_TOKEN = "env-token";
    try {
      const provider = makeProvider({ listBookings: jest.fn().mockResolvedValue([]) });
      const { service } = makeService(tx, provider);

      const result = await service.reconcile({});

      expect(provider.listBookings).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ polled: 0, applied: 0, matched: 0, skipped: 0, failedTargets: 0 });
      // a non-expert default poll advances no watermark
      expect(tx.expert.update).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.TIDYCAL_API_TOKEN;
      else process.env.TIDYCAL_API_TOKEN = prev;
    }
  });

  it("skips an expert whose configured token won't decrypt — never polls the global calendar under their id", async () => {
    // Regression for Security/Product Cycle 4 High: a decrypt failure must NOT fall back to the
    // env-global provider, or the shared calendar's bookings get attributed to the failing expert.
    const tx = makeTx();
    seedExpert(tx); // one configured expert (exp_1)
    const prev = process.env.TIDYCAL_API_TOKEN;
    process.env.TIDYCAL_API_TOKEN = "env-token"; // a global token DOES exist — must still not be used
    try {
      const globalProvider = makeProvider({ listBookings: jest.fn().mockResolvedValue([CREATED]) });
      // Factory mirrors the real one: forExpert returns null on decrypt failure; default() is the global.
      const factory = {
        default: () => globalProvider,
        forExpert: () => null,
      } as unknown as ConstructorParameters<typeof BookingService>[0];
      const prisma = {
        $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
      } as unknown as ConstructorParameters<typeof BookingService>[1];
      const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
      const service = new BookingService(factory, prisma, logger);

      const result = await service.reconcile({});

      // The global provider was never polled, and the skip is surfaced as failedTargets.
      expect(globalProvider.listBookings).not.toHaveBeenCalled();
      expect(result).toEqual({ polled: 0, applied: 0, matched: 0, skipped: 0, failedTargets: 1 });
      // No booking was recorded under the failing expert, and the watermark was not advanced.
      expect(tx.bookingWebhookEvent.create).not.toHaveBeenCalled();
      expect(tx.expert.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ failedTargets: 1 }),
      );
    } finally {
      if (prev === undefined) delete process.env.TIDYCAL_API_TOKEN;
      else process.env.TIDYCAL_API_TOKEN = prev;
    }
  });

  it("does nothing when there are no configured experts and no env token", async () => {
    const tx = makeTx();
    tx.expert.findMany.mockResolvedValue([]);
    const prev = process.env.TIDYCAL_API_TOKEN;
    delete process.env.TIDYCAL_API_TOKEN;
    try {
      const provider = makeProvider({ listBookings: jest.fn() });
      const { service } = makeService(tx, provider);

      const result = await service.reconcile({});

      expect(provider.listBookings).not.toHaveBeenCalled();
      expect(result).toEqual({ polled: 0, applied: 0, matched: 0, skipped: 0, failedTargets: 0 });
    } finally {
      if (prev !== undefined) process.env.TIDYCAL_API_TOKEN = prev;
    }
  });
});

describe("BookingService.listUnmatched", () => {
  it("maps unmatched ledger rows to DTOs (dates → ISO, null scheduledAt preserved)", async () => {
    const tx = makeTx();
    const received = new Date("2026-06-09T12:00:00.000Z");
    tx.bookingWebhookEvent.findMany.mockResolvedValue([
      {
        id: "evt_a",
        provider: "tidycal",
        eventType: "booking.created",
        bookingRef: "bkg_a",
        email: "ghost@expertos.local",
        scheduledAt: SCHEDULED_AT,
        receivedAt: received,
      },
      {
        id: "evt_b",
        provider: "offline",
        eventType: "booking.cancelled",
        bookingRef: null,
        email: null,
        scheduledAt: null,
        receivedAt: received,
      },
    ]);
    const { service } = makeService(tx, makeProvider());

    const rows = await service.listUnmatched({ limit: 50, offset: 0 });

    expect(tx.bookingWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matched: false },
        orderBy: { receivedAt: "desc" },
        take: 50,
        skip: 0,
      }),
    );
    expect(rows).toEqual([
      {
        id: "evt_a",
        provider: "tidycal",
        eventType: "booking.created",
        bookingRef: "bkg_a",
        email: "ghost@expertos.local",
        scheduledAt: SCHEDULED_AT.toISOString(),
        receivedAt: received.toISOString(),
      },
      {
        id: "evt_b",
        provider: "offline",
        eventType: "booking.cancelled",
        bookingRef: null,
        email: null,
        scheduledAt: null,
        receivedAt: received.toISOString(),
      },
    ]);
  });

  it("passes the limit/offset page window through to the query", async () => {
    const tx = makeTx();
    tx.bookingWebhookEvent.findMany.mockResolvedValue([]);
    const { service } = makeService(tx, makeProvider());

    const rows = await service.listUnmatched({ limit: 10, offset: 20 });

    expect(rows).toEqual([]);
    expect(tx.bookingWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
  });
});
