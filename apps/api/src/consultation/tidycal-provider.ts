import type { ConsultationStatus } from "@expertos/db";

/**
 * The booking-provider seam (M7.3, resolves Open Decision #10; reworked to polling in M16). **All
 * booking traffic goes through this interface — no app code talks to TidyCal directly**, so swapping
 * to a native scheduler later (Phase 3) is a new driver, not a rewrite.
 *
 * **TidyCal has no native webhooks** (confirmed against TidyCal's FAQ), so the production driver
 * ({@link HttpTidyCalProvider}) syncs bookings by **polling** {@link listBookings} (`GET /bookings`
 * with the expert's API token) on a schedule. Its {@link verifyWebhook}/{@link parseEvent} reject /
 * no-op — only the {@link OfflineTidyCalProvider} implements the JSON-envelope webhook seam, which
 * exists solely so local/dev/test can drive the book → consultation-sync path deterministically
 * without TidyCal or network (mirroring the {@link PaymentProvider} / `EchoLlmProvider` pattern).
 *
 * TidyCal is the booking **source of truth**; {@link BookingService} mirrors every polled event into
 * our own `consultations` + `booking_webhook_events` tables so the funnel attribution (M10.2) never
 * depends on the TidyCal dashboard.
 */
export interface TidyCalProvider {
  /** Stable driver name, recorded on `booking_webhook_events.provider` (e.g. `tidycal`, `offline`). */
  readonly name: string;

  /**
   * Offline/test seam only: verify a JSON-envelope delivery and return the provider's event object.
   * The {@link OfflineTidyCalProvider} trusts the local payload; {@link HttpTidyCalProvider} throws
   * {@link BookingWebhookVerificationError} because TidyCal never posts webhooks.
   */
  verifyWebhook(req: BookingWebhookRequest): Promise<unknown>;

  /**
   * Offline/test seam only: map a verified envelope onto our normalized {@link BookingEvent}, or
   * `null` to ignore it. Pure — no IO. The production driver returns `null` (it receives no webhooks).
   */
  parseEvent(rawEvent: unknown): BookingEvent | null;

  /**
   * Poll the provider for bookings updated at/after `since`, normalized to {@link BookingEvent}s — the
   * **production sync path**. Each entry uses a deterministic synthetic `eventId`
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
  /**
   * Idempotency key. A delivery-unique provider event id when present; otherwise a synthesized
   * per-transition fallback — `fallback:<bookingRef>:<type>:<lifecycleStamp>` (webhook with no id) or
   * `reconcile:<bookingRef>:<type>` (poll) — never the bare `bookingRef`, which would collapse a
   * later reschedule/cancel into the create's key.
   */
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
