import { z } from "zod";

/**
 * Consultation-funnel wire types (M7, PRD §"Consultation funnel"). M7.1 surfaces an in-chat
 * recommendation on the terminal `done` event of a chat turn; the user's Book / Maybe later / Ask
 * another response (M7.2) is recorded against the persisted recommendation `id`.
 */

/**
 * Why the recommendation engine fired (mirrors the `recommendation_trigger` DB enum and the
 * `@expertos/ai` engine). Kept as a leaf string union here so neither the DB nor the AI package
 * leaks into the shared wire contract.
 */
export type RecommendationTriggerValue = "topic" | "depth" | "low_confidence" | "high_intent";

/** A bookable consultation type as surfaced to the client (the booking link is wired in M7.2). */
export interface ConsultationTypeDto {
  key: string;
  name: string;
  durationMinutes: number;
  /** TidyCal booking link, or null until configured (the M7.2 booking integration consumes it). */
  tidycalLink: string | null;
}

/**
 * An in-chat consultation recommendation (M7.1). Carried on the chat `done` event when a rule fires;
 * absent/null otherwise (the common case — a normal answer doesn't nag the user). The client renders
 * a Book / Maybe later / Ask another prompt and reports the choice back against `id` (M7.2).
 */
export interface ConsultationRecommendationDto {
  /** The persisted `consultation_recommendations` row id — the M7.2 response is recorded against it. */
  id: string;
  trigger: RecommendationTriggerValue;
  /** Short, plain-language reason shown in the in-chat prompt. */
  reason: string;
  /** The consultation type to book, or null to fall back to a generic "book a consultation" CTA. */
  consultationType: ConsultationTypeDto | null;
}

/**
 * The user's response to an in-chat recommendation (M7.2). Mirrors the actionable values of the
 * `recommendation_response` DB enum — the `pending` default (never chosen) is deliberately excluded
 * so the client can only report a real choice. `book` initiates the TidyCal booking; the other two
 * dismiss the prompt (and are still recorded as funnel signal for M10.2 attribution).
 */
export type RecommendationResponseValue = "book" | "maybe_later" | "ask_another";

/**
 * Record the user's response to a recommendation (M7.2). Only the choice is supplied — the
 * recommendation is addressed by the `:id` path param and ownership is enforced server-side by
 * Postgres RLS (`consultation_recommendations` is user-scoped, directive §4.21), so the client
 * can't respond to another user's recommendation. Which consultation type gets booked is derived
 * server-side from the recommendation's stored trigger (directive §26), never trusted from the client.
 */
export const recommendationRespondSchema = z.object({
  response: z.enum(["book", "maybe_later", "ask_another"]),
});

export type RecommendationRespondInput = z.infer<typeof recommendationRespondSchema>;

/**
 * A booking handle returned when the user chose to book (M7.2). The `consultations` row is the
 * funnel-attribution join (question → conversation → recommendation → booking → revenue, M10.2);
 * the client opens `tidycalLink` to let the user pick a slot. `tidycalLink` is null when the
 * consultation type has no link configured yet — the client then shows a "we'll be in touch" note.
 */
export interface ConsultationBookingDto {
  /** The created/linked `consultations` row id (the attribution join key). */
  consultationId: string;
  /** TidyCal booking link to open, or null when not yet configured for the type. */
  tidycalLink: string | null;
}

/**
 * Result of recording a recommendation response (M7.2). `booking` is present only when the user
 * chose `book` and an active consultation type could be resolved; for `maybe_later`/`ask_another`
 * (or when no bookable type exists) it is null and the client simply dismisses the prompt.
 */
export interface RecommendationResponseResultDto {
  id: string;
  response: RecommendationResponseValue;
  booking: ConsultationBookingDto | null;
}

/**
 * Admin-triggered missed-event recovery for TidyCal bookings (M7.3, resolves Open Decision #10).
 * Booking confirmation normally arrives by webhook; this polls TidyCal for bookings since `since`
 * (default: a recent lookback window) and idempotently applies any the webhook missed, so a
 * booked-but-unconfirmed consultation never silently vanishes. `since` is an ISO timestamp.
 */
export const bookingReconcileSchema = z.object({
  since: z.coerce.date().optional(),
});

export type BookingReconcileInput = z.infer<typeof bookingReconcileSchema>;

/**
 * Summary of a reconcile run (M7.3). `polled` bookings were fetched from TidyCal; `applied` were newly
 * recorded (`matched` of those correlated to a user/consultation); `skipped` were already in the
 * idempotency ledger. A non-zero `applied` means the webhook had missed events that recovery caught.
 */
export interface BookingReconcileResultDto {
  polled: number;
  applied: number;
  matched: number;
  skipped: number;
}
