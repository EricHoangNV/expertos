import {
  type BookingEvent,
  type BookingEventType,
  type BookingWebhookRequest,
  BookingWebhookVerificationError,
  statusForBookingEvent,
  type TidyCalProvider,
} from "./tidycal-provider";

const EVENT_TYPES: readonly BookingEventType[] = [
  "booking.created",
  "booking.cancelled",
  "booking.rescheduled",
];

/**
 * Offline, in-process booking provider — the analog of {@link OfflinePaymentProvider} /
 * `EchoLlmProvider` so the entire booking-confirmation path (book → webhook → consultation sync,
 * plus reconcile recovery) runs deterministically without TidyCal or network. Used in local dev and
 * tests; production swaps {@link HttpTidyCalProvider} behind the `TIDYCAL_PROVIDER` token.
 *
 * Webhooks carry a **trusted JSON {@link BookingEvent} envelope** (there is no signing offline); a
 * local script or test posts one to the booking webhook route to drive the same DB-sync code TidyCal
 * would. {@link listBookings} returns no entries offline (nothing to poll) — a test injects a stub
 * provider to exercise the reconcile path.
 */
export class OfflineTidyCalProvider implements TidyCalProvider {
  readonly name = "offline";

  async verifyWebhook(req: BookingWebhookRequest): Promise<unknown> {
    // No signature scheme offline; the payload is trusted JSON (local/dev/test only).
    try {
      return JSON.parse(req.payload.toString("utf8"));
    } catch {
      throw new BookingWebhookVerificationError("Malformed offline booking webhook payload");
    }
  }

  parseEvent(rawEvent: unknown): BookingEvent | null {
    return parseOfflineBookingEvent(rawEvent);
  }

  async listBookings(_input: { since: Date }): Promise<BookingEvent[]> {
    // Nothing to poll offline — reconcile is a no-op (tests inject a stub to drive the recovery path).
    return [];
  }
}

/**
 * Validates the offline webhook envelope into a {@link BookingEvent}. The envelope *is* the normalized
 * event (with an ISO `scheduledAt` string), so this only type-checks, defaults the status from the
 * event type, and coerces the date. Anything unrecognized → `null` (ignored), matching the real
 * driver's "unknown event type → null" behavior.
 */
export function parseOfflineBookingEvent(raw: unknown): BookingEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const e = raw as Record<string, unknown>;
  const eventType = e.eventType;
  if (typeof eventType !== "string" || !EVENT_TYPES.includes(eventType as BookingEventType)) {
    return null;
  }
  if (typeof e.bookingRef !== "string" || e.bookingRef.length === 0) {
    return null;
  }
  const scheduledAt = toDate(e.scheduledAt);
  return {
    // Mirror the real driver: an explicit envelope `eventId` wins, else synthesize a per-transition
    // fallback (ref + type + scheduled time) so a later reschedule/cancel for the same booking is not
    // collapsed into the create's idempotency key.
    eventId:
      typeof e.eventId === "string" && e.eventId.length > 0
        ? e.eventId
        : `fallback:${e.bookingRef}:${eventType}:${scheduledAt ? scheduledAt.getTime() : "na"}`,
    eventType: eventType as BookingEventType,
    bookingRef: e.bookingRef,
    email: typeof e.email === "string" ? e.email : null,
    scheduledAt,
    status: statusForBookingEvent(eventType as BookingEventType),
  };
}

/** Coerces an ISO date string (or epoch ms number) to a Date; anything else → null. */
function toDate(value: unknown): Date | null {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
