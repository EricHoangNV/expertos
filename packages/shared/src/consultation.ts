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
 * TidyCal booking sync (M16 — per-expert polling; supersedes the M7.3 webhook recovery framing).
 * TidyCal has no native webhooks, so this poll **is** the sync path: it fetches each expert's bookings
 * since `since` (default: per-expert watermark, else a recent lookback) via that expert's API token and
 * idempotently applies them, so a booked consultation is never lost. Runs on a schedule (Cloud
 * Scheduler) and on demand from the admin portal. `since` is an ISO timestamp; `expertId` optionally
 * narrows the run to one expert (omitted ⇒ every expert with a configured token).
 */
export const bookingReconcileSchema = z.object({
  since: z.coerce.date().optional(),
  expertId: z.string().uuid().optional(),
});

export type BookingReconcileInput = z.infer<typeof bookingReconcileSchema>;

/**
 * Summary of a reconcile run (M7.3). `polled` bookings were fetched from TidyCal; `applied` were newly
 * recorded (`matched` of those correlated to a user/consultation); `skipped` were already in the
 * idempotency ledger. A non-zero `applied` means the webhook had missed events that recovery caught.
 * `failedTargets` counts experts skipped because their configured TidyCal token could not be decrypted
 * (those calendars were NOT polled — a non-zero value warrants an operator alert / key check).
 */
export interface BookingReconcileResultDto {
  polled: number;
  applied: number;
  matched: number;
  skipped: number;
  failedTargets: number;
}

/**
 * Trailing list query for the unmatched-booking feed (M7.3 admin recovery surface): a page of the
 * most-recent rows, newest first.
 */
export const unmatchedBookingListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type UnmatchedBookingListQueryInput = z.infer<typeof unmatchedBookingListQuerySchema>;

/**
 * One booking webhook event that could not be correlated to a user/consultation (`matched = false`).
 * These are kept in the ledger rather than dropped (the OD#10 no-vanish guarantee), so the admin
 * portal surfaces them: a booking whose contact email matched no user, awaiting manual recovery.
 */
export interface UnmatchedBookingEventDto {
  /** The `booking_webhook_events` row id. */
  id: string;
  /** Booking provider that delivered the event (`tidycal`, `offline`, …). */
  provider: string;
  /** The normalized event kind (`booking.created` / `booking.cancelled` / `booking.rescheduled`). */
  eventType: string;
  /** The provider's booking reference, or null when the event carried none. */
  bookingRef: string | null;
  /** The booking contact email (why it stayed unmatched: no user has it), or null. */
  email: string | null;
  /** The booked time (UTC ISO), or null when the event carried none. */
  scheduledAt: string | null;
  /** When the event was recorded in the ledger (UTC ISO). */
  receivedAt: string;
}

// ── M8.3 — admin recommendation-rules editor ───────────────────────────────

/**
 * Which recommendation trigger a rule is keyed on (mirrors the `recommendation_trigger` DB enum and
 * the `@expertos/ai` engine). The four triggers are fixed in code, so the editor edits the existing
 * rows rather than creating arbitrary new ones; the trigger is the rule's identity (carried in the
 * `PATCH` path, never the body — directive §4.7).
 */
export const recommendationTriggerSchema = z.enum([
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
]);

/** Guard rails on an editable rule — accidental-absurd-value protection, not product limits. */
const MAX_THRESHOLD = 1000;
const MAX_PRIORITY = 1000;
const MAX_KEYWORDS = 200;
const MAX_KEYWORD_LEN = 80;

/**
 * The editable fields of one recommendation rule
 * (`PATCH /admin/recommendation-rules/:trigger`). Identity (`trigger`) lives in the path, never the
 * body. Type coherence is derived server-side from the trigger (directive §4.20): a keyword trigger
 * (`topic`/`high_intent`) ignores `threshold` (forced `null`), and a threshold trigger
 * (`depth`/`low_confidence`) ignores `keywords` (forced `[]`). The service additionally rejects an
 * *enabled* rule that could never fire (a keyword rule with no keywords, a threshold rule with no
 * threshold) and an unknown `consultationTypeKey`.
 */
export const recommendationRuleUpdateSchema = z.object({
  /** Whether the rule is active (a disabled rule never fires). */
  enabled: z.boolean(),
  /** Threshold triggers only: `depth` min turns / `low_confidence` max citations (`null` = none). */
  threshold: z.number().int().min(0).max(MAX_THRESHOLD).nullable().default(null),
  /** Keyword triggers only: whole-word match terms (`[]` = none). */
  keywords: z
    .array(z.string().trim().min(1).max(MAX_KEYWORD_LEN))
    .max(MAX_KEYWORDS)
    .default([]),
  /** Higher wins when several rules fire on the same turn (only one recommendation is surfaced). */
  priority: z.number().int().min(0).max(MAX_PRIORITY).default(0),
  /** Which `consultation_types.key` to recommend, or `null` to fall back to the active default. */
  consultationTypeKey: z.string().trim().min(1).nullable().default(null),
});

export type RecommendationRuleUpdateInput = z.infer<typeof recommendationRuleUpdateSchema>;

/**
 * One recommendation rule as shown in the admin editor. `kind` is derived server-side from the
 * trigger so the UI can show only the relevant control (keyword list vs threshold) without
 * re-deciding which trigger is which.
 */
export interface RecommendationRuleDto {
  trigger: RecommendationTriggerValue;
  enabled: boolean;
  /** Threshold triggers (`depth`/`low_confidence`) only; `null` for keyword triggers. */
  threshold: number | null;
  /** Keyword triggers (`topic`/`high_intent`) only; empty for threshold triggers. */
  keywords: string[];
  priority: number;
  /** The configured consultation type's key, or `null` to fall back to the active default. */
  consultationTypeKey: string | null;
  /** Whether the trigger matches on keywords or a numeric threshold (derived from `trigger`). */
  kind: "keyword" | "threshold";
}

/** A consultation type offered in the rule editor's "recommend" dropdown. */
export interface RecommendationConsultationTypeDto {
  key: string;
  name: string;
  active: boolean;
}

/**
 * The recommendation-rules editor payload (`GET /admin/recommendation-rules`): every configured rule
 * (highest priority first) plus the consultation types an admin can point a rule at.
 */
export interface RecommendationRulesDto {
  rules: RecommendationRuleDto[];
  consultationTypes: RecommendationConsultationTypeDto[];
}
