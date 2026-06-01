import type { ConsultationStatus } from "@expertos/db";

/**
 * The booking-provider seam (M7.3, resolves Open Decision #10). **All booking-confirmation traffic
 * goes through this interface — no app code talks to TidyCal directly**, so swapping to a native
 * scheduler later (Phase 3) is a new driver, not a rewrite. The offline default
 * ({@link OfflineTidyCalProvider}) keeps the whole book → webhook → consultation-sync path runnable
 * without TidyCal or network (mirroring the {@link PaymentProvider} / `EchoLlmProvider` pattern); the
 * real {@link TidyCalProvider} driver swaps in behind the `TIDYCAL_PROVIDER` token when its webhook
 * secret is present.
 *
 * TidyCal is the booking **source of truth**; {@link BookingService} mirrors every event into our own
 * `consultations` + `booking_webhook_events` tables ({@link parseEvent} normalizes the provider's event
 * shape into {@link BookingEvent}) so the funnel attribution (M10.2) and missed-event recovery never
 * depend on the TidyCal dashboard.
 */
export interface TidyCalProvider {
  /** Stable driver name, recorded on `booking_webhook_events.provider` (e.g. `tidycal`, `offline`). */
  readonly name: string;

  /**
   * Verify a webhook delivery's signature over the **raw** request bytes and return the provider's
   * event object. Throws {@link BookingWebhookVerificationError} on a missing/invalid signature — the
   * body is attacker-reachable, so an unverified payload is never trusted.
   */
  verifyWebhook(req: BookingWebhookRequest): Promise<unknown>;

  /**
   * Map a verified provider event onto our normalized {@link BookingEvent}, or `null` for an event
   * type we deliberately ignore. Pure — no IO — so it is exhaustively unit-testable.
   */
  parseEvent(rawEvent: unknown): BookingEvent | null;

  /**
   * Poll the provider for bookings updated at/after `since`, normalized to {@link BookingEvent}s — the
   * missed-event recovery path. Each entry uses a deterministic synthetic `eventId`
   * (`reconcile:<bookingRef>:<eventType>`) so replaying the poll is idempotent against the ledger. The
   * default driver needs live network (exercised at deploy, not in CI — the M11 caveat).
   */
  listBookings(input: { since: Date }): Promise<BookingEvent[]>;
}

/** The normalized booking event kinds {@link BookingService} acts on. */
export type BookingEventType = "booking.created" | "booking.cancelled" | "booking.rescheduled";

/**
 * A booking lifecycle event mirrored from a TidyCal webhook (or recovered by the reconcile poll).
 * {@link BookingService} correlates it to a `consultations` row by {@link bookingRef} (then by
 * {@link email}) and idempotently records it in `booking_webhook_events` keyed on {@link eventId}.
 */
export interface BookingEvent {
  /** Provider event id (webhook) or synthetic `reconcile:<bookingRef>:<type>` (poll) — idempotency key. */
  eventId: string;
  eventType: BookingEventType;
  /** TidyCal booking id — the correlation key back to a consultation (booking links can be static). */
  bookingRef: string;
  /** Booking contact email — matches an inbound booking to a user when no consultation exists yet. */
  email: string | null;
  /** When the consultation is scheduled (null for a cancellation or an unscheduled booking). */
  scheduledAt: Date | null;
  /** The `consultations.status` this event maps to (`booked` for created/rescheduled, `canceled`). */
  status: ConsultationStatus;
}

export interface BookingWebhookRequest {
  /** The exact raw request bytes — signature verification must run over the unparsed body. */
  payload: Buffer;
  /** The provider signature header value (TidyCal's `tidycal-signature`); may be absent. */
  signature: string | undefined;
}

/**
 * Thrown by a driver's {@link TidyCalProvider.verifyWebhook} when the signature is missing or does not
 * match. {@link BookingService} translates it into a `400` so an unverified webhook is rejected (never
 * silently trusted, never a `500`) — mirroring the billing `WebhookVerificationError`.
 */
export class BookingWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingWebhookVerificationError";
  }
}

/**
 * Maps a normalized {@link BookingEventType} to the `consultations.status` it produces. A creation or a
 * reschedule lands the consultation in `booked`; a cancellation moves it to `canceled`. Single-sourced
 * here so the offline + real drivers can't drift.
 */
export function statusForBookingEvent(type: BookingEventType): ConsultationStatus {
  return type === "booking.cancelled" ? "canceled" : "booked";
}
