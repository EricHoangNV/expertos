import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type BookingEvent,
  type BookingEventType,
  type BookingWebhookRequest,
  BookingWebhookVerificationError,
  statusForBookingEvent,
  type TidyCalProvider,
} from "./tidycal-provider";

/**
 * The HTTP transport for TidyCal's REST API, declared structurally so this driver takes **no TidyCal
 * SDK dependency** (same pattern as the Stripe `StripeHttpClient` / chat `SseResponse`). The default
 * {@link FetchTidyCalHttpClient} uses the global `fetch`; a test injects a fake to assert the request
 * params (and feed booking pages) without a network call.
 */
export interface TidyCalHttpClient {
  /** Issue a GET to a TidyCal API `path` (e.g. `/bookings`) with optional query params. */
  get(path: string, query?: Record<string, string>): Promise<Record<string, unknown>>;
}

interface HttpTidyCalProviderOptions {
  webhookSecret: string;
  /** API token for the reconcile poll (`listBookings`); absent ⇒ poll yields nothing. */
  apiToken?: string;
  /** Swappable transport (defaults to a `fetch`-based client over `https://tidycal.com/api`). */
  httpClient?: TidyCalHttpClient;
}

/** TidyCal webhook event names → our normalized {@link BookingEventType} (others are ignored). */
const EVENT_NAME_MAP: Record<string, BookingEventType> = {
  "booking.created": "booking.created",
  "booking_created": "booking.created",
  "booking.cancelled": "booking.cancelled",
  "booking.canceled": "booking.cancelled",
  "booking_cancelled": "booking.cancelled",
  "booking.rescheduled": "booking.rescheduled",
  "booking_rescheduled": "booking.rescheduled",
};

/**
 * TidyCal driver (Phase-1's only real {@link TidyCalProvider}). The security-critical, network-free
 * parts — webhook **signature verification** (HMAC-SHA256 over the raw body) and **event parsing** —
 * are implemented directly with `node:crypto` and are exhaustively unit-tested. The reconcile poll
 * ({@link listBookings}) issues a REST call through the injected {@link TidyCalHttpClient}; the default
 * transport needs live network (verified at deploy, not in CI — the M11 caveat, same as the Stripe
 * `FetchStripeHttpClient`), but the param construction + page mapping stay testable via the fake.
 */
export class HttpTidyCalProvider implements TidyCalProvider {
  readonly name = "tidycal";
  private readonly webhookSecret: string;
  private readonly apiToken?: string;
  private readonly http: TidyCalHttpClient;

  constructor(opts: HttpTidyCalProviderOptions) {
    this.webhookSecret = opts.webhookSecret;
    this.apiToken = opts.apiToken;
    this.http = opts.httpClient ?? new FetchTidyCalHttpClient(opts.apiToken);
  }

  async verifyWebhook(req: BookingWebhookRequest): Promise<unknown> {
    if (!req.signature) {
      throw new BookingWebhookVerificationError("Missing tidycal-signature header");
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(req.payload)
      .digest("hex");
    if (!safeEqualHex(req.signature, expected)) {
      throw new BookingWebhookVerificationError("Booking webhook signature does not match");
    }
    try {
      return JSON.parse(req.payload.toString("utf8"));
    } catch {
      throw new BookingWebhookVerificationError("Booking webhook body is not valid JSON");
    }
  }

  parseEvent(rawEvent: unknown): BookingEvent | null {
    if (!isRecord(rawEvent)) {
      return null;
    }
    const eventName = typeof rawEvent.event === "string" ? rawEvent.event : "";
    const eventType = EVENT_NAME_MAP[eventName];
    if (!eventType) {
      return null;
    }
    const booking = isRecord(rawEvent.payload) ? rawEvent.payload : rawEvent;
    const normalized = toBookingEvent(booking, eventType);
    if (!normalized) {
      return null;
    }
    // Prefer a delivery-unique webhook id. When TidyCal omits it, the fallback MUST stay unique per
    // lifecycle transition — keying it on `bookingRef` alone collapses a later reschedule/cancel into
    // the create's idempotency key, so `BookingService` would skip it as a duplicate and the
    // consultation status/schedule would go stale (Security Cycle 2 High). Synthesize from booking
    // ref + event type + the transition's lifecycle timestamp instead.
    const eventId =
      typeof rawEvent.id === "string" && rawEvent.id.length > 0
        ? rawEvent.id
        : fallbackEventId(booking, normalized);
    return { ...normalized, eventId };
  }

  async listBookings(input: { since: Date }): Promise<BookingEvent[]> {
    if (!this.apiToken) {
      return [];
    }
    const res = await this.http.get("/bookings", {
      starts_at: input.since.toISOString(),
    });
    const data = Array.isArray(res.data) ? res.data : [];
    const events: BookingEvent[] = [];
    for (const row of data) {
      if (!isRecord(row)) {
        continue;
      }
      const eventType: BookingEventType = row.cancelled_at ? "booking.cancelled" : "booking.created";
      const normalized = toBookingEvent(row, eventType);
      if (normalized) {
        // Synthetic, deterministic id so re-polling the same booking is idempotent against the ledger.
        events.push({ ...normalized, eventId: `reconcile:${normalized.bookingRef}:${eventType}` });
      }
    }
    return events;
  }
}

/** Build the booking fields shared by webhook + poll. Returns null when the booking id is absent. */
function toBookingEvent(
  booking: Record<string, unknown>,
  eventType: BookingEventType,
): Omit<BookingEvent, "eventId"> | null {
  const bookingRef = stringifyId(booking.id);
  if (!bookingRef) {
    return null;
  }
  const contact = isRecord(booking.contact) ? booking.contact : undefined;
  const email =
    (contact && typeof contact.email === "string" ? contact.email : undefined) ??
    (typeof booking.email === "string" ? booking.email : null);
  return {
    eventType,
    bookingRef,
    email,
    scheduledAt: toDate(booking.starts_at),
    status: statusForBookingEvent(eventType),
  };
}

/**
 * Synthesize an idempotency key for a webhook with no provider `id`. It must be **deterministic** (a
 * redelivery of the *same* transition is still a no-op against the ledger) yet **distinct per
 * transition** (a later reschedule/cancel for the same booking is not collapsed into the create). We
 * combine the booking ref, the normalized event type, and the lifecycle timestamp of *this*
 * transition (cancel time / reschedule time / create time, depending on the event).
 */
function fallbackEventId(
  booking: Record<string, unknown>,
  normalized: Omit<BookingEvent, "eventId">,
): string {
  const stamp = lifecycleStamp(booking, normalized.eventType, normalized.scheduledAt);
  return `fallback:${normalized.bookingRef}:${normalized.eventType}:${stamp}`;
}

/**
 * The epoch-ms timestamp of the lifecycle transition this event represents, used to disambiguate
 * repeated transitions (e.g. two reschedules) when the provider gives no delivery-unique id. Prefers
 * the field that actually advances on that transition, then the new scheduled time (which moves on a
 * reschedule), and finally `na` when the payload carries no usable timestamp.
 */
function lifecycleStamp(
  booking: Record<string, unknown>,
  eventType: BookingEventType,
  scheduledAt: Date | null,
): string {
  const candidates =
    eventType === "booking.cancelled"
      ? [booking.cancelled_at, booking.updated_at]
      : eventType === "booking.rescheduled"
        ? [booking.rescheduled_at, booking.updated_at]
        : [booking.created_at, booking.updated_at];
  for (const candidate of candidates) {
    const date = toDate(candidate);
    if (date) {
      return String(date.getTime());
    }
  }
  // The scheduled time changes on a reschedule, so it keeps distinct transitions apart as a backstop.
  return scheduledAt ? String(scheduledAt.getTime()) : "na";
}

/** TidyCal ids may arrive as a number or string — coerce to a non-empty string, else null. */
function stringifyId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

/**
 * Default TidyCal transport: bearer-token GETs to `https://tidycal.com/api`. Needs live network, so it
 * is exercised at deploy time, not in CI (the M11 integration caveat, same as the Stripe
 * `FetchStripeHttpClient` / GCS storage driver).
 */
class FetchTidyCalHttpClient implements TidyCalHttpClient {
  private static readonly BASE_URL = "https://tidycal.com/api";

  constructor(private readonly apiToken?: string) {}

  async get(path: string, query?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${FetchTidyCalHttpClient.BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken ?? ""}`,
        Accept: "application/json",
      },
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`TidyCal API GET ${path} failed with ${res.status}`);
    }
    return body;
  }
}
