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
import {
  type ExpertCredentials,
  TidyCalProviderFactory,
} from "./tidycal-provider.factory";
import {
  type BookingEvent,
  type BookingWebhookRequest,
  BookingWebhookVerificationError,
  type TidyCalProvider,
} from "./tidycal-provider";

/** How far back a poll looks when an expert has no watermark and no explicit `since` is given (24h). */
const DEFAULT_RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** The outcome of applying one booking event — drives the reconcile summary counters. */
type ApplyOutcome = "matched" | "unmatched" | "duplicate";

/** One expert to poll: its credentials provider, the window to poll, and the watermark to advance to. */
interface PollTarget {
  /** The expert whose calendar this polls, or null for the env-global/offline default poll. */
  expertId: string | null;
  provider: TidyCalProvider;
  since: Date;
  /** Timestamp captured before the poll → the next watermark (null skips the watermark write). */
  polledAt: Date | null;
}

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
 * Booking-confirmation sync (M7.3 → reworked to **per-expert polling** in M16; resolves Open
 * Decision #10).
 *
 * M7.2 creates a `consultations` row at Book-click (`status: recommended`, attributed to the
 * conversation's expert) and returns the TidyCal link; this service flips that row to `booked` when the
 * user completes the booking on TidyCal, recording the `bookingRef` / `scheduledAt`.
 *
 * **TidyCal has no native webhooks**, so confirmation can't be pushed to us. {@link reconcile} is the
 * production sync path: for each expert with a configured API token, poll `GET /bookings` (via that
 * expert's {@link TidyCalProvider}) and idempotently apply the results. It runs on a schedule (Cloud
 * Scheduler → the admin reconcile route) and on demand. {@link handleWebhook} remains only as the
 * **offline/dev/test seam** — a local JSON envelope drives the same sync code without TidyCal.
 *
 * **Correlation** (the OD#10 concern — a polled booking doesn't say which consultation it is): match
 * first by `bookingRef` (a follow-up event for a booking we already linked), then by the booking
 * **email** → that user's most-recent pending `recommended` consultation, scoped to the polling expert.
 * A booking made outside the funnel still creates a `booked` consultation (attributed to the expert) so
 * it never vanishes; an email matching no user is recorded `matched=false` for an admin to reconcile.
 *
 * **Idempotency** is keyed on `booking_webhook_events.[provider, eventId]`; the poll namespaces the
 * synthetic id per expert so two experts' identically-numbered bookings can't collide.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly providers: TidyCalProviderFactory,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Offline/dev/test seam only: apply a local JSON-envelope "webhook". The {@link OfflineTidyCalProvider}
   * trusts the payload; the real driver rejects it (TidyCal posts no webhooks), so in production this
   * returns `400`. Events are applied with no expert scope (the offline envelope carries none; the
   * already-attributed pending consultation supplies the expert).
   */
  async handleWebhook(req: BookingWebhookRequest): Promise<void> {
    const provider = this.providers.default();
    // Defense-in-depth: the offline provider trusts an *unsigned* JSON envelope (it is a local/test
    // seam). It must never run in production — otherwise a misconfigured prod (no `TIDYCAL_API_TOKEN`,
    // so `default()` resolves offline) would accept forged bookings on this `@Public` route. In a
    // correctly-configured prod `default()` is the HTTP driver, whose `verifyWebhook` rejects anyway.
    if (provider.name === "offline" && process.env.NODE_ENV === "production") {
      throw new BadRequestException("offline booking webhook is disabled in production");
    }
    let rawEvent: unknown;
    try {
      rawEvent = await provider.verifyWebhook(req);
    } catch (err) {
      if (err instanceof BookingWebhookVerificationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const event = provider.parseEvent(rawEvent);
    if (!event) {
      return;
    }
    await this.runAsSystem((tx) => this.applyBookingEvent(tx, event, provider.name, null));
  }

  /**
   * Poll TidyCal per-expert and idempotently apply any bookings. Safe to run on a schedule or on
   * demand. Returns counts so the admin can see whether the run caught anything new.
   */
  async reconcile(input: BookingReconcileInput): Promise<BookingReconcileResultDto> {
    const { targets, failedTargets } = await this.resolveTargets(input);

    const result: BookingReconcileResultDto = {
      polled: 0,
      applied: 0,
      matched: 0,
      skipped: 0,
      failedTargets,
    };
    for (const target of targets) {
      const events = await target.provider.listBookings({ since: target.since });
      result.polled += events.length;
      for (const event of events) {
        const scoped = this.scopeEventToExpert(event, target.expertId);
        const outcome = await this.runAsSystem((tx) =>
          this.applyBookingEvent(tx, scoped, target.provider.name, target.expertId),
        );
        if (outcome === "duplicate") {
          result.skipped += 1;
        } else {
          result.applied += 1;
          if (outcome === "matched") {
            result.matched += 1;
          }
        }
      }
      if (target.expertId && target.polledAt) {
        await this.advanceWatermark(target.expertId, target.polledAt);
      }
    }
    if (result.applied > 0) {
      this.logger.info("booking reconcile applied polled bookings", {
        polled: result.polled,
        applied: result.applied,
        matched: result.matched,
      });
    }
    if (result.failedTargets > 0) {
      // An expert with a configured token we couldn't decrypt was skipped (not polled under the
      // global calendar). Surface it so an operator can check the encryption key / re-enter the token.
      this.logger.warn("booking reconcile skipped experts with undecryptable TidyCal tokens", {
        failedTargets: result.failedTargets,
      });
    }
    return result;
  }

  /**
   * Build the list of experts to poll. `expertId` narrows to one; otherwise every expert with a
   * configured token. When none is configured but a global env token exists, fall back to a single
   * default poll (the pre-migration single-calendar behavior). The poll window per expert is the
   * explicit `since`, else that expert's watermark, else a 24h lookback.
   *
   * Returns the poll targets plus `failedTargets`: experts whose configured token could not be
   * decrypted. Those are SKIPPED, not polled under the env-global calendar — polling the shared
   * calendar while attributing its bookings to that expert would misassign bookings/revenue.
   */
  private async resolveTargets(
    input: BookingReconcileInput,
  ): Promise<{ targets: PollTarget[]; failedTargets: number }> {
    const experts = await this.runAsSystem((tx) => {
      const where: Prisma.ExpertWhereInput = input.expertId
        ? { id: input.expertId }
        : { tidycalApiTokenEnc: { not: null } };
      return tx.expert.findMany({
        where,
        select: { id: true, tidycalApiTokenEnc: true, tidycalPolledAt: true },
      });
    });

    const now = new Date();
    const fallbackSince = input.since ?? new Date(now.getTime() - DEFAULT_RECONCILE_LOOKBACK_MS);

    if (experts.length === 0) {
      // No per-expert tokens configured. If an env-global token exists, do one default poll so the
      // legacy single calendar keeps syncing; otherwise (offline) there is nothing to poll.
      if (!input.expertId && process.env.TIDYCAL_API_TOKEN) {
        return {
          targets: [
            { expertId: null, provider: this.providers.default(), since: fallbackSince, polledAt: null },
          ],
          failedTargets: 0,
        };
      }
      return { targets: [], failedTargets: 0 };
    }

    const targets: PollTarget[] = [];
    let failedTargets = 0;
    for (const expert of experts) {
      const provider = this.providers.forExpert(expert as ExpertCredentials);
      if (!provider) {
        // Configured token that won't decrypt → skip this expert entirely (never poll someone else's
        // calendar under their id). The factory already logged the expert id + failure class.
        failedTargets += 1;
        continue;
      }
      targets.push({
        expertId: expert.id,
        provider,
        since: input.since ?? expert.tidycalPolledAt ?? fallbackSince,
        polledAt: now,
      });
    }
    return { targets, failedTargets };
  }

  /** Namespace a polled event's synthetic id by expert so two experts' ids can't collide in the ledger. */
  private scopeEventToExpert(event: BookingEvent, expertId: string | null): BookingEvent {
    if (!expertId) {
      return event;
    }
    return { ...event, eventId: `expert:${expertId}:${event.eventId}` };
  }

  /** Advance an expert's poll watermark to the timestamp captured before this run's poll. */
  private async advanceWatermark(expertId: string, polledAt: Date): Promise<void> {
    await this.runAsSystem((tx) =>
      tx.expert.update({ where: { id: expertId }, data: { tidycalPolledAt: polledAt } }),
    );
  }

  /**
   * The admin recovery feed: booking events that could not be correlated to a user/consultation
   * (`matched = false`), newest first. Kept (not dropped) so an admin can reconcile them — the OD#10
   * no-vanish guarantee. Reads in the same system context as the poll path; the `@Roles("admin")` route
   * guard is the access boundary.
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
    provider: string,
    expertId: string | null,
  ): Promise<ApplyOutcome> {
    // Idempotency: a re-poll / redelivered envelope with the same (provider, eventId) is a no-op.
    const seen = await tx.bookingWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: event.eventId } },
      select: { id: true },
    });
    if (seen) {
      return "duplicate";
    }

    const { consultationId, matched } = await this.correlate(tx, event, expertId);

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
      this.logger.warn("booking poll unmatched; awaiting reconciliation", {
        bookingRef: event.bookingRef,
        eventType: event.eventType,
      });
    }
    return matched ? "matched" : "unmatched";
  }

  /**
   * Resolve the `consultations` row a booking event belongs to, applying the status/schedule. Order:
   * (1) by `bookingRef` — a follow-up event (reschedule/cancel) for a booking we already linked;
   * (2) by booking email → the user's most-recent pending `recommended` consultation (the M7.2 row),
   * scoped to the polling `expertId` when one is supplied;
   * (3) a booking outside the funnel → create a `booked` consultation so it doesn't vanish.
   * Returns `matched: false` only when no user could be resolved from the email. When `expertId` is
   * supplied it is stamped onto the matched/created consultation (attribution back-fill).
   */
  private async correlate(
    tx: Prisma.TransactionClient,
    event: BookingEvent,
    expertId: string | null,
  ): Promise<{ consultationId: string | null; matched: boolean }> {
    const existing = await tx.consultation.findFirst({
      where: { bookingRef: event.bookingRef },
      select: { id: true, expertId: true },
    });
    if (existing) {
      await tx.consultation.update({
        where: { id: existing.id },
        data: {
          status: event.status,
          scheduledAt: event.scheduledAt ?? undefined,
          // Back-fill attribution only if not already set, so a re-poll never reassigns the expert.
          expertId: existing.expertId ?? expertId ?? undefined,
        },
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
      where: {
        userId: user.id,
        status: "recommended",
        bookingRef: null,
        // A per-expert poll only claims that expert's pending consultations; the default poll (no
        // expert) matches any, preserving the pre-migration single-calendar behavior.
        ...(expertId ? { expertId } : {}),
      },
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
        expertId: expertId ?? undefined,
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
   * Runs poll DB work in a system RLS context (admin GUC, GLOBAL tenant) — there is no request
   * principal for a scheduled poll, and a single booking can touch any tenant's rows. Mirrors
   * {@link BillingService}'s `runAsSystem`.
   */
  private runAsSystem<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
      return work(tx);
    });
  }
}
