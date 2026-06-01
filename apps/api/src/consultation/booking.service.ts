import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  applyRlsContext,
  GLOBAL_TENANT_ID,
  Prisma,
  type PrismaClient,
} from "@expertos/db";
import type {
  BookingReconcileInput,
  BookingReconcileResultDto,
  UnmatchedBookingEventDto,
  UnmatchedBookingListQueryInput,
} from "@expertos/shared";
import { StructuredLogger } from "../observability/logger.service";
import { PRISMA } from "../database/database.module";
import { TIDYCAL_PROVIDER } from "./tidycal.tokens";
import {
  type BookingEvent,
  type BookingWebhookRequest,
  BookingWebhookVerificationError,
  type TidyCalProvider,
} from "./tidycal-provider";

/** How far back the reconcile poll looks when no explicit `since` is given (24h). */
const DEFAULT_RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** The outcome of applying one booking event — drives the reconcile summary counters. */
type ApplyOutcome = "matched" | "unmatched" | "duplicate";

/** The `booking_webhook_events` columns the unmatched feed selects (dates still as `Date`). */
interface UnmatchedBookingRow {
  id: string;
  provider: string;
  eventType: string;
  bookingRef: string | null;
  email: string | null;
  scheduledAt: Date | null;
  receivedAt: Date;
}

/** Flatten a ledger row into the public {@link UnmatchedBookingEventDto} (dates → ISO strings). */
function toUnmatchedBookingDto(row: UnmatchedBookingRow): UnmatchedBookingEventDto {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.eventType,
    bookingRef: row.bookingRef,
    email: row.email,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    receivedAt: row.receivedAt.toISOString(),
  };
}

/**
 * Booking-confirmation sync (M7.3, PRD §"Consultation funnel"; resolves Open Decision #10).
 *
 * M7.2 created a `consultations` row at Book-click (`status: recommended`) and returned the static
 * TidyCal link; this service flips that row to `booked` when the user actually completes the booking,
 * recording the `bookingRef` / `scheduledAt`. It is the booking analog of {@link BillingService} and
 * mirrors its webhook discipline exactly:
 *
 * - {@link handleWebhook} — the **unauthenticated** TidyCal callback: verify the signature over the raw
 *   body, normalize the event, and idempotently sync it into `consultations` + the
 *   `booking_webhook_events` ledger, all in a **system RLS context** ({@link runAsSystem}) because
 *   there is no request principal — the pattern {@link BillingService.handleWebhook} uses.
 * - {@link reconcile} — admin-triggered **missed-event recovery**: poll TidyCal for recent bookings and
 *   replay each through the same idempotent apply, so a dropped webhook doesn't leave a booking in limbo.
 *
 * **Correlation** (the OD#10 reliability concern — TidyCal links are static, so the inbound event
 * doesn't know which consultation it is): match first by `bookingRef` (a later event for a booking we
 * already linked), then by the booking **email** → the user's most-recent pending `recommended`
 * consultation. A booking made outside the funnel still creates a `booked` consultation so it never
 * vanishes; an email that matches no user is recorded `matched=false` for an admin to reconcile.
 *
 * **Idempotency** is keyed on `booking_webhook_events.[provider, eventId]` (pre-check + P2002 catch,
 * exactly like the M6.2 `transactions` ledger) — a redelivered webhook or a re-poll is a no-op.
 */
@Injectable()
export class BookingService {
  constructor(
    @Inject(TIDYCAL_PROVIDER) private readonly provider: TidyCalProvider,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Verify + apply a TidyCal webhook. Throws `400` on an unverifiable signature; an event type we don't
   * model is a silent no-op (we only mirror booking lifecycle events).
   */
  async handleWebhook(req: BookingWebhookRequest): Promise<void> {
    let rawEvent: unknown;
    try {
      rawEvent = await this.provider.verifyWebhook(req);
    } catch (err) {
      if (err instanceof BookingWebhookVerificationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const event = this.provider.parseEvent(rawEvent);
    if (!event) {
      return;
    }
    await this.runAsSystem((tx) => this.applyBookingEvent(tx, event));
  }

  /**
   * Missed-event recovery: poll TidyCal for bookings since `since` (default: a 24h lookback) and apply
   * any the webhook missed. Idempotent — already-ledgered events are skipped — so it is safe to run on
   * a schedule or on demand from the admin portal (M8). Returns counts for the admin to see whether
   * recovery actually caught anything.
   */
  async reconcile(input: BookingReconcileInput): Promise<BookingReconcileResultDto> {
    const since = input.since ?? new Date(Date.now() - DEFAULT_RECONCILE_LOOKBACK_MS);
    const events = await this.provider.listBookings({ since });

    const result: BookingReconcileResultDto = {
      polled: events.length,
      applied: 0,
      matched: 0,
      skipped: 0,
    };
    for (const event of events) {
      const outcome = await this.runAsSystem((tx) => this.applyBookingEvent(tx, event));
      if (outcome === "duplicate") {
        result.skipped += 1;
      } else {
        result.applied += 1;
        if (outcome === "matched") {
          result.matched += 1;
        }
      }
    }
    if (result.applied > 0) {
      this.logger.info("booking reconcile recovered missed events", {
        polled: result.polled,
        applied: result.applied,
        matched: result.matched,
      });
    }
    return result;
  }

  /**
   * The admin recovery feed: booking events that could not be correlated to a user/consultation
   * (`matched = false`), newest first. These are kept (not dropped) so an admin can see and reconcile
   * them — the OD#10 no-vanish guarantee. Reads in the same system context as the webhook/reconcile
   * paths (`booking_webhook_events` is RLS-exempt and an unmatched booking can belong to any tenant);
   * the `@Roles("admin")` route guard is the access boundary.
   */
  async listUnmatched(
    query: UnmatchedBookingListQueryInput,
  ): Promise<UnmatchedBookingEventDto[]> {
    return this.runAsSystem(async (tx) => {
      const rows = await tx.bookingWebhookEvent.findMany({
        where: { matched: false },
        orderBy: { receivedAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          provider: true,
          eventType: true,
          bookingRef: true,
          email: true,
          scheduledAt: true,
          receivedAt: true,
        },
      });
      return rows.map(toUnmatchedBookingDto);
    });
  }

  /**
   * Idempotently correlate + record one booking event. Returns whether it was newly matched, recorded
   * unmatched, or a duplicate (already in the ledger). Runs inside {@link runAsSystem}.
   */
  private async applyBookingEvent(
    tx: Prisma.TransactionClient,
    event: BookingEvent,
  ): Promise<ApplyOutcome> {
    const provider = this.provider.name;

    // Idempotency: a redelivered webhook / re-poll with the same (provider, eventId) is a no-op.
    const seen = await tx.bookingWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: event.eventId } },
      select: { id: true },
    });
    if (seen) {
      return "duplicate";
    }

    const { consultationId, matched } = await this.correlate(tx, event);

    try {
      await tx.bookingWebhookEvent.create({
        data: {
          provider,
          eventId: event.eventId,
          eventType: event.eventType,
          bookingRef: event.bookingRef,
          email: event.email,
          scheduledAt: event.scheduledAt,
          consultationId,
          matched,
          payload: this.toPayload(event),
        },
      });
    } catch (err) {
      // Lost a race with a concurrent redelivery of the same event — still idempotent.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return "duplicate";
      }
      throw err;
    }

    if (!matched) {
      // A booking we couldn't tie to a user — kept (not dropped) so an admin can reconcile it (OD#10).
      this.logger.warn("booking webhook unmatched; awaiting reconciliation", {
        bookingRef: event.bookingRef,
        eventType: event.eventType,
      });
    }
    return matched ? "matched" : "unmatched";
  }

  /**
   * Resolve the `consultations` row a booking event belongs to, applying the status/schedule. Order:
   * (1) by `bookingRef` — a follow-up event (reschedule/cancel) for a booking we already linked;
   * (2) by booking email → the user's most-recent pending `recommended` consultation (the M7.2 row);
   * (3) a booking outside the funnel → create a `booked` consultation so it doesn't vanish.
   * Returns `matched: false` only when no user could be resolved from the email.
   */
  private async correlate(
    tx: Prisma.TransactionClient,
    event: BookingEvent,
  ): Promise<{ consultationId: string | null; matched: boolean }> {
    const existing = await tx.consultation.findFirst({
      where: { bookingRef: event.bookingRef },
      select: { id: true },
    });
    if (existing) {
      await tx.consultation.update({
        where: { id: existing.id },
        data: { status: event.status, scheduledAt: event.scheduledAt ?? undefined },
      });
      return { consultationId: existing.id, matched: true };
    }

    const user = event.email
      ? await tx.user.findFirst({
          where: { email: event.email },
          orderBy: { createdAt: "desc" },
          select: { id: true, tenantId: true },
        })
      : null;
    if (!user) {
      return { consultationId: null, matched: false };
    }

    const pending = await tx.consultation.findFirst({
      where: { userId: user.id, status: "recommended", bookingRef: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (pending) {
      await tx.consultation.update({
        where: { id: pending.id },
        data: {
          status: event.status,
          bookingRef: event.bookingRef,
          scheduledAt: event.scheduledAt ?? undefined,
        },
      });
      return { consultationId: pending.id, matched: true };
    }

    const created = await tx.consultation.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        status: event.status,
        bookingRef: event.bookingRef,
        scheduledAt: event.scheduledAt,
      },
      select: { id: true },
    });
    return { consultationId: created.id, matched: true };
  }

  /** Normalized JSON snapshot kept on the ledger row for audit / manual recovery. */
  private toPayload(event: BookingEvent): Prisma.InputJsonValue {
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      bookingRef: event.bookingRef,
      email: event.email,
      scheduledAt: event.scheduledAt ? event.scheduledAt.toISOString() : null,
      status: event.status,
    };
  }

  /**
   * Runs webhook/reconcile DB work in a system RLS context (admin GUC, GLOBAL tenant) — there is no
   * request principal for a provider callback, and a single booking can touch any tenant's rows.
   * Mirrors {@link BillingService}'s `runAsSystem`.
   */
  private runAsSystem<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
      return work(tx);
    });
  }
}
