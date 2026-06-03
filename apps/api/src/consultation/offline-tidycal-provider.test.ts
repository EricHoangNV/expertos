import {
  OfflineTidyCalProvider,
  parseOfflineBookingEvent,
} from "./offline-tidycal-provider";
import { BookingWebhookVerificationError } from "./tidycal-provider";

function buf(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

describe("OfflineTidyCalProvider", () => {
  const provider = new OfflineTidyCalProvider();

  it("verifies a webhook by parsing the trusted JSON payload", async () => {
    const event = { eventType: "booking.created", bookingRef: "bkg_1" };
    await expect(provider.verifyWebhook({ payload: buf(event), signature: undefined })).resolves.toEqual(
      event,
    );
  });

  it("throws a verification error on a malformed payload", async () => {
    await expect(
      provider.verifyWebhook({ payload: Buffer.from("not json", "utf8"), signature: undefined }),
    ).rejects.toBeInstanceOf(BookingWebhookVerificationError);
  });

  it("polls nothing offline (reconcile is a no-op without a real provider)", async () => {
    await expect(provider.listBookings({ since: new Date() })).resolves.toEqual([]);
  });

  it("parses a created event, defaulting status to booked and coercing the date", () => {
    const event = provider.parseEvent({
      eventId: "evt_9",
      eventType: "booking.created",
      bookingRef: "bkg_9",
      email: "u@expertos.local",
      scheduledAt: "2026-06-10T15:00:00.000Z",
    });
    expect(event).toEqual({
      eventId: "evt_9",
      eventType: "booking.created",
      bookingRef: "bkg_9",
      email: "u@expertos.local",
      scheduledAt: new Date("2026-06-10T15:00:00.000Z"),
      status: "booked",
    });
  });

  it("maps a cancelled event to canceled status", () => {
    const event = parseOfflineBookingEvent({
      eventType: "booking.cancelled",
      bookingRef: "bkg_2",
    });
    expect(event?.status).toBe("canceled");
    expect(event?.eventType).toBe("booking.cancelled");
  });

  it("synthesizes a per-transition fallback eventId when none is given, and email/date default to null", () => {
    const event = parseOfflineBookingEvent({ eventType: "booking.rescheduled", bookingRef: "bkg_3" });
    expect(event).toEqual({
      // ref + type + scheduled time (here `na`, no date) — not the bare bookingRef, so a later
      // cancel/reschedule for the same booking does not collide with the create's idempotency key.
      eventId: "fallback:bkg_3:booking.rescheduled:na",
      eventType: "booking.rescheduled",
      bookingRef: "bkg_3",
      email: null,
      scheduledAt: null,
      status: "booked",
    });
  });

  it("gives created/rescheduled/cancelled distinct fallback ids for the same booking", () => {
    const at = (iso: string) => ({ bookingRef: "bkg_4", scheduledAt: iso });
    const created = parseOfflineBookingEvent({
      eventType: "booking.created",
      ...at("2026-06-10T15:00:00.000Z"),
    });
    const rescheduled = parseOfflineBookingEvent({
      eventType: "booking.rescheduled",
      ...at("2026-06-12T15:00:00.000Z"),
    });
    const canceled = parseOfflineBookingEvent({ eventType: "booking.cancelled", bookingRef: "bkg_4" });
    expect(new Set([created?.eventId, rescheduled?.eventId, canceled?.eventId]).size).toBe(3);
  });

  it("returns null for a non-object, an unknown event type, or a missing bookingRef", () => {
    expect(parseOfflineBookingEvent(null)).toBeNull();
    expect(parseOfflineBookingEvent("nope")).toBeNull();
    expect(parseOfflineBookingEvent({ eventType: "booking.exploded", bookingRef: "x" })).toBeNull();
    expect(parseOfflineBookingEvent({ eventType: "booking.created" })).toBeNull();
    expect(parseOfflineBookingEvent({ eventType: "booking.created", bookingRef: "" })).toBeNull();
  });
});
