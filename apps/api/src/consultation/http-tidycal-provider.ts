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
  /** API token for the booking poll (`listBookings`); absent ⇒ poll yields nothing. */
  apiToken?: string;
  /** Swappable transport (defaults to a `fetch`-based client over `https://tidycal.com/api`). */
  httpClient?: TidyCalHttpClient;
}

/**
 * TidyCal driver (M16 — per-expert polling). **TidyCal has no native webhooks** (confirmed against
 * TidyCal's FAQ), so this driver never receives inbound deliveries: {@link verifyWebhook} rejects and
 * {@link parseEvent} is a no-op. Booking sync is the **poll** ({@link listBookings} → `GET /bookings`)
 * driven by {@link BookingService.reconcile} on a schedule, idempotent against the
 * `booking_webhook_events` ledger via deterministic `reconcile:<bookingRef>:<eventType>` ids. The
 * default transport needs live network (verified at deploy, not in CI — the M11 caveat, same as the
 * Stripe `FetchStripeHttpClient`), but the param construction + page mapping stay testable via the fake.
 *
 * The offline JSON-envelope webhook seam still exists for local/dev/test ({@link OfflineTidyCalProvider});
 * it is the only provider whose {@link verifyWebhook}/{@link parseEvent} do anything.
 */
export class HttpTidyCalProvider implements TidyCalProvider {
  readonly name = "tidycal";
  private readonly apiToken?: string;
  private readonly http: TidyCalHttpClient;

  constructor(opts: HttpTidyCalProviderOptions) {
    this.apiToken = opts.apiToken;
    this.http = opts.httpClient ?? new FetchTidyCalHttpClient(opts.apiToken);
  }

  /**
   * TidyCal never posts webhooks, so any inbound delivery routed to this driver is unexpected and
   * untrusted — reject it rather than process an unverifiable body. Production booking sync is the poll.
   */
  async verifyWebhook(_req: BookingWebhookRequest): Promise<unknown> {
    throw new BookingWebhookVerificationError(
      "TidyCal has no native webhooks; bookings sync via the polling reconcile path",
    );
  }

  /** Unreachable in practice (no inbound webhooks reach this driver); a no-op for interface parity. */
  parseEvent(_rawEvent: unknown): BookingEvent | null {
    return null;
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

/** Build the booking fields from a poll row. Returns null when the booking id is absent. */
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
