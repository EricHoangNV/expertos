import { z } from "zod";

/**
 * Concierge (human-in-the-loop) wire types (M9, PRD §"Concierge Mode"). M9.1 ships the admin
 * trigger config: when the AI is low-confidence, the config decides whether a human steps in and how.
 *
 * The config is a global singleton edited by admins (`GET`/`PATCH /admin/concierge-config`). The rest
 * of M9 (review queue, async delivery, reviewer-feedback flywheel) reads it.
 */

/**
 * How the concierge trigger fires when enabled (mirrors the `review_trigger_mode` DB enum). Kept as a
 * leaf string union here so the DB enum never leaks into the shared wire contract.
 *  - `user_prompted` — **Mode A**: the chat offers "would you like our team to review this?" and the
 *    user opts in.
 *  - `auto_silent` — **Mode B**: the user sees a normal AI answer while it is quietly queued for human
 *    review behind the scenes. Highest-liability mechanism — gated on the OD#5 legal/brand sign-off.
 */
export const REVIEW_TRIGGER_MODES = ["user_prompted", "auto_silent"] as const;
export type ReviewTriggerModeValue = (typeof REVIEW_TRIGGER_MODES)[number];
export const reviewTriggerModeSchema = z.enum(REVIEW_TRIGGER_MODES);

/** Guard rails — accidental-absurd-value protection, not product limits. */
const MAX_SLA_HOURS = 720; // 30 days
const MAX_VOLUME_CAP = 100_000;

/**
 * The editable concierge trigger config (`PATCH /admin/concierge-config`). There is no identity field
 * — it is a global singleton. The service additionally rejects enabling **Mode B** (`auto_silent`)
 * until the OD#5 legal/brand sign-off flips the runtime allow-flag (directive §4.14: validate enums +
 * ranges; the legal gate is a server-side policy the client can't bypass).
 */
export const reviewConfigUpdateSchema = z.object({
  /** Master switch. `false` = Off (no human-review trigger), regardless of `triggerMode`. */
  enabled: z.boolean(),
  /** Mode A (`user_prompted`) vs Mode B (`auto_silent`). Only meaningful when `enabled`. */
  triggerMode: reviewTriggerModeSchema,
  /** Fire the trigger when the answer's confidence is at or below this (0–1). */
  confidenceThreshold: z.number().min(0).max(1),
  /** Service-level agreement shown to the user ("a human is reviewing — we'll email you"). */
  slaHours: z.number().int().min(1).max(MAX_SLA_HOURS),
  /** Daily cap on queued reviews so the expert team isn't swamped. */
  volumeCapPerDay: z.number().int().min(1).max(MAX_VOLUME_CAP),
});

export type ReviewConfigUpdateInput = z.infer<typeof reviewConfigUpdateSchema>;

/**
 * The concierge trigger config as shown in the admin editor (`GET /admin/concierge-config`).
 * `silentReviewAllowed` is derived server-side from the runtime legal-gate flag (OD#5) so the UI can
 * disable the Mode B option (and explain why) until legal signs off — it is not an editable field.
 */
export interface ReviewConfigDto {
  enabled: boolean;
  triggerMode: ReviewTriggerModeValue;
  confidenceThreshold: number;
  slaHours: number;
  volumeCapPerDay: number;
  /** Whether Mode B (silent review) may be enabled yet — gated on the OD#5 legal/brand sign-off. */
  silentReviewAllowed: boolean;
  /** ISO-8601 last-updated timestamp, or null if the config has never been saved. */
  updatedAt: string | null;
}

// ── concierge review queue (M9.2) ───────────────────────────────────────────

/**
 * Lifecycle of a queued human-review request (mirrors the `review_request_status` DB enum):
 * `requested` (enqueued by the trigger) → `answered` (a reviewer recorded a verdict). `in_review`,
 * `escalated`, and `dismissed` are reserved for the richer reviewer workflow (claim / escalate-to-
 * consultation in M9.4); M9.2's `respond` moves a request straight to `answered`.
 */
export const REVIEW_REQUEST_STATUSES = [
  "requested",
  "in_review",
  "answered",
  "escalated",
  "dismissed",
] as const;
export type ReviewRequestStatusValue = (typeof REVIEW_REQUEST_STATUSES)[number];
export const reviewRequestStatusSchema = z.enum(REVIEW_REQUEST_STATUSES);

/** Whether the review is surfaced to the user (Mode A) or runs as a silent shadow review (Mode B). */
export type ReviewVisibilityValue = "visible" | "silent";

/**
 * A reviewer's quality verdict on an AI answer (mirrors the `review_verdict` DB enum). `great`/edited
 * answers feed the global flywheel (voice examples + knowledge drafts); `bad` flags the source chunks
 * (M9.4). Kept a leaf string union so the DB enum never leaks into the shared wire contract.
 */
export const REVIEW_VERDICTS = ["good", "bad", "great"] as const;
export type ReviewVerdictValue = (typeof REVIEW_VERDICTS)[number];
export const reviewVerdictSchema = z.enum(REVIEW_VERDICTS);

/** Accidental-absurd-value guard, not a product limit. */
const MAX_REVIEW_PAGE = 200;

/**
 * Page query for the concierge review queue (`GET /concierge-reviews`). `expertId` lets an admin
 * target a specific expert; a non-admin reviewer is scoped to their own voice regardless of it. An
 * optional `status` narrows the feed (e.g. only `requested` items still awaiting a reviewer).
 */
export const conciergeQueueListQuerySchema = z.object({
  status: reviewRequestStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(MAX_REVIEW_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ConciergeQueueListQueryInput = z.infer<typeof conciergeQueueListQuerySchema>;

/** One reviewer's recorded response to a queued review (`review_responses` row). */
export interface ReviewResponseDto {
  id: string;
  /** The reviewer (expert/admin) who recorded the verdict. */
  reviewerId: string;
  verdict: ReviewVerdictValue;
  /** The AI answer as it stood when the reviewer responded. */
  originalAnswer: string;
  /** The reviewer's edited answer, or null when they left a verdict without editing. */
  revisedAnswer: string | null;
  /** True when `revisedAnswer` is a real change to `originalAnswer`. */
  edited: boolean;
  /** Free-text reviewer notes, or null. */
  notes: string | null;
  /** Whether the revised answer has been pushed back to the user yet (async delivery is M9.3). */
  deliveredToUser: boolean;
  createdAt: string;
}

/**
 * One item in the concierge review queue (`GET /concierge-reviews`), newest-actionable first. Carries
 * a preview of the AI answer awaiting review plus its SLA/status so the reviewer can triage; the full
 * answer + prompting question + recorded responses come from the detail view ({@link ReviewQueueDetailDto}).
 */
export interface ReviewQueueItemDto {
  /** The `human_review_requests` row id. */
  id: string;
  /** The assistant message under review. */
  messageId: string;
  conversationId: string;
  triggerMode: ReviewTriggerModeValue;
  visibility: ReviewVisibilityValue;
  /** The answer's confidence (0–1), or null when no score was recorded (the deterministic proxy fired). */
  confidenceScore: number | null;
  status: ReviewRequestStatusValue;
  /** ISO SLA deadline shown to triage by urgency, or null when no SLA applied. */
  slaDueAt: string | null;
  /** ISO timestamp the request was claimed, or null. */
  claimedAt: string | null;
  /** ISO timestamp a reviewer answered, or null. */
  answeredAt: string | null;
  createdAt: string;
  /** A short preview of the AI answer awaiting review. */
  answerPreview: string;
  /** The most-recent reviewer verdict, or null when not yet reviewed. */
  latestVerdict: ReviewVerdictValue | null;
  /** How many reviewer responses have been recorded. */
  responseCount: number;
}

/**
 * The full concierge review detail (`GET /concierge-reviews/:id`): the queue item fields plus the
 * complete AI answer, the prompting question, and every recorded reviewer response.
 */
export interface ReviewQueueDetailDto
  extends Omit<ReviewQueueItemDto, "answerPreview" | "latestVerdict" | "responseCount"> {
  /** The full AI answer under review. */
  answer: string;
  /** The prompting question (the most-recent user message at/before the answer), or null. */
  question: string | null;
  /** All recorded reviewer responses, newest first (subsumes the list view's latest-verdict/count). */
  responses: ReviewResponseDto[];
}

/**
 * A reviewer's verdict + optional edit on a queued answer (`POST /concierge-reviews/:id/respond`,
 * M9.2). `revisedAnswer` is the reviewer's improved text (null = verdict only, no edit); the service
 * derives `edited` by comparing it to the original. `notes` is optional reviewer commentary.
 */
export const reviewResponseCreateSchema = z.object({
  verdict: reviewVerdictSchema,
  revisedAnswer: z.string().trim().min(1).max(50_000).nullable().default(null),
  notes: z.string().trim().min(1).max(2_000).nullable().default(null),
});

export type ReviewResponseCreateInput = z.infer<typeof reviewResponseCreateSchema>;

/**
 * Escalate a concierge case into a paid consultation (`POST /concierge-reviews/:id/escalate`, M9.4).
 * A reviewer who judges an answer needs a deeper, live engagement opens a `recommended` consultation
 * for the asking user and moves the review request to `escalated`. `consultationTypeKey` optionally
 * picks a specific consultation type (falls back to the active default); `notes` is reviewer context.
 */
export const reviewEscalateSchema = z.object({
  consultationTypeKey: z.string().trim().min(1).max(120).nullable().default(null),
  notes: z.string().trim().min(1).max(2_000).nullable().default(null),
});

export type ReviewEscalateInput = z.infer<typeof reviewEscalateSchema>;

/** Result of escalating a concierge review to a consultation (M9.4). */
export interface ReviewEscalationDto {
  /** The escalated `human_review_requests` row. */
  reviewRequestId: string;
  /** The request's new status (`escalated`). */
  status: ReviewRequestStatusValue;
  /** The `consultations` row opened for the asking user. */
  consultationId: string;
  /** The resolved consultation type key, or null when no active type exists. */
  consultationTypeKey: string | null;
  /** The TidyCal booking link for the resolved type, or null. */
  tidycalLink: string | null;
}
