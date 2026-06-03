import { createHmac } from "node:crypto";
import { HttpTidyCalProvider, type TidyCalHttpClient } from "./http-tidycal-provider";
import { BookingWebhookVerificationError } from "./tidycal-provider";

const SECRET = "whsec_test";

function sign(payload: Buffer): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function makeProvider(opts: { apiToken?: string; httpClient?: TidyCalHttpClient } = {}) {
  return new HttpTidyCalProvider({ webhookSecret: SECRET, ...opts });
}

describe("HttpTidyCalProvider.verifyWebhook", () => {
  const provider = makeProvider();

  it("verifies a correctly-signed payload and returns the parsed JSON", async () => {
    const payload = Buffer.from(JSON.stringify({ event: "booking.created" }), "utf8");
    await expect(provider.verifyWebhook({ payload, signature: sign(payload) })).resolves.toEqual({
      event: "booking.created",
    });
  });

  it("rejects a missing signature header", async () => {
    const payload = Buffer.from("{}", "utf8");
    await expect(provider.verifyWebhook({ payload, signature: undefined })).rejects.toBeInstanceOf(
      BookingWebhookVerificationError,
    );
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const payload = Buffer.from(JSON.stringify({ event: "booking.created" }), "utf8");
    const sig = sign(payload);
    const tampered = Buffer.from(JSON.stringify({ event: "booking.cancelled" }), "utf8");
    await expect(provider.verifyWebhook({ payload: tampered, signature: sig })).rejects.toBeInstanceOf(
      BookingWebhookVerificationError,
    );
  });

  it("rejects a verified-but-non-JSON body", async () => {
    const payload = Buffer.from("not json", "utf8");
    await expect(provider.verifyWebhook({ payload, signature: sign(payload) })).rejects.toBeInstanceOf(
      BookingWebhookVerificationError,
    );
  });
});

describe("HttpTidyCalProvider.parseEvent", () => {
  const provider = makeProvider();

  it("normalizes a created webhook with a nested contact + numeric id", () => {
    const event = provider.parseEvent({
      id: "evt_1",
      event: "booking_created",
      payload: {
        id: 42,
        starts_at: "2026-06-10T15:00:00.000Z",
        contact: { email: "u@expertos.local" },
      },
    });
    expect(event).toEqual({
      eventId: "evt_1",
      eventType: "booking.created",
      bookingRef: "42",
      email: "u@expertos.local",
      scheduledAt: new Date("2026-06-10T15:00:00.000Z"),
      status: "booked",
    });
  });

  it("maps cancellation aliases to canceled and synthesizes a per-transition fallback eventId", () => {
    const event = provider.parseEvent({
      event: "booking.canceled",
      payload: { id: "bkg_7", email: "x@y.z", cancelled_at: "2026-06-09T00:00:00.000Z" },
    });
    expect(event).toMatchObject({
      // ref + type + the cancel's lifecycle timestamp — distinct from the booking's create event.
      eventId: `fallback:bkg_7:booking.cancelled:${Date.parse("2026-06-09T00:00:00.000Z")}`,
      eventType: "booking.cancelled",
      bookingRef: "bkg_7",
      email: "x@y.z",
      status: "canceled",
    });
  });

  it("gives created/rescheduled/cancelled distinct fallback ids for the same booking (no webhook id)", () => {
    // The Security Cycle 2 High regression: with no delivery-unique `id`, a later reschedule/cancel
    // for the same booking must NOT collide with the create's idempotency key.
    const created = provider.parseEvent({
      event: "booking.created",
      payload: { id: 99, starts_at: "2026-06-10T15:00:00.000Z", contact: { email: "a@b.c" } },
    });
    const rescheduled = provider.parseEvent({
      event: "booking.rescheduled",
      payload: { id: 99, starts_at: "2026-06-12T15:00:00.000Z", contact: { email: "a@b.c" } },
    });
    const canceled = provider.parseEvent({
      event: "booking.cancelled",
      payload: { id: 99, cancelled_at: "2026-06-13T09:00:00.000Z", contact: { email: "a@b.c" } },
    });

    const ids = [created?.eventId, rescheduled?.eventId, canceled?.eventId];
    expect(new Set(ids).size).toBe(3);
    expect(created?.eventId).toBe(
      `fallback:99:booking.created:${Date.parse("2026-06-10T15:00:00.000Z")}`,
    );
    expect(rescheduled?.eventId).toBe(
      `fallback:99:booking.rescheduled:${Date.parse("2026-06-12T15:00:00.000Z")}`,
    );
    expect(canceled?.eventId).toBe(
      `fallback:99:booking.cancelled:${Date.parse("2026-06-13T09:00:00.000Z")}`,
    );
  });

  it("synthesizes the same fallback id for a redelivery of the same transition (idempotent)", () => {
    const payload = {
      event: "booking.rescheduled",
      payload: { id: 7, starts_at: "2026-07-01T10:00:00.000Z", contact: { email: "a@b.c" } },
    };
    expect(provider.parseEvent(payload)?.eventId).toBe(provider.parseEvent(payload)?.eventId);
  });

  it("two reschedules of the same booking get distinct fallback ids via the new scheduled time", () => {
    const first = provider.parseEvent({
      event: "booking.rescheduled",
      payload: { id: 7, starts_at: "2026-07-01T10:00:00.000Z" },
    });
    const second = provider.parseEvent({
      event: "booking.rescheduled",
      payload: { id: 7, starts_at: "2026-07-05T10:00:00.000Z" },
    });
    expect(first?.eventId).not.toBe(second?.eventId);
  });

  it("falls back to `na` in the fallback id when no lifecycle timestamp is present", () => {
    const event = provider.parseEvent({
      event: "booking.cancelled",
      payload: { id: "bkg_7", email: "x@y.z" },
    });
    expect(event?.eventId).toBe("fallback:bkg_7:booking.cancelled:na");
  });

  it("prefers a delivery-unique webhook id over the synthesized fallback", () => {
    const event = provider.parseEvent({
      id: "evt_unique",
      event: "booking.created",
      payload: { id: 99, starts_at: "2026-06-10T15:00:00.000Z" },
    });
    expect(event?.eventId).toBe("evt_unique");
  });

  it("returns null for a non-object, an unmodeled event name, or a booking with no id", () => {
    expect(provider.parseEvent(null)).toBeNull();
    expect(provider.parseEvent({ event: "invoice.paid", payload: { id: 1 } })).toBeNull();
    expect(provider.parseEvent({ event: "booking.created", payload: {} })).toBeNull();
  });
});

describe("HttpTidyCalProvider.listBookings", () => {
  it("returns nothing when no API token is configured (poll disabled)", async () => {
    const provider = makeProvider();
    await expect(provider.listBookings({ since: new Date() })).resolves.toEqual([]);
  });

  it("polls bookings, builds deterministic synthetic event ids, and maps cancellations", async () => {
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: 1, starts_at: "2026-06-10T15:00:00.000Z", contact: { email: "a@b.c" } },
        { id: 2, cancelled_at: "2026-06-09T00:00:00.000Z", contact: { email: "d@e.f" } },
        "garbage-row",
      ],
    });
    const provider = makeProvider({ apiToken: "tok", httpClient: { get } });
    const since = new Date("2026-06-01T00:00:00.000Z");

    const events = await provider.listBookings({ since });

    expect(get).toHaveBeenCalledWith("/bookings", { starts_at: since.toISOString() });
    expect(events).toEqual([
      {
        eventId: "reconcile:1:booking.created",
        eventType: "booking.created",
        bookingRef: "1",
        email: "a@b.c",
        scheduledAt: new Date("2026-06-10T15:00:00.000Z"),
        status: "booked",
      },
      {
        eventId: "reconcile:2:booking.cancelled",
        eventType: "booking.cancelled",
        bookingRef: "2",
        email: "d@e.f",
        scheduledAt: null,
        status: "canceled",
      },
    ]);
  });

  it("tolerates a response with no data array", async () => {
    const get = jest.fn().mockResolvedValue({});
    const provider = makeProvider({ apiToken: "tok", httpClient: { get } });
    await expect(provider.listBookings({ since: new Date() })).resolves.toEqual([]);
  });
});
