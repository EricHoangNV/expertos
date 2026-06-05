import { z } from "zod";
import type { RecommendationTriggerValue, RecommendationResponseValue } from "./consultation";

/**
 * Expert-portal wire types (M8.5, PRD §"Expert portal"). The expert portal is a tenant-local,
 * **voice-scoped** view: an expert sees the consultation conversions and AI answers that arose from
 * conversations held in *their* voice (`conversations.expert_id`), not the whole tenant. The funnel
 * data (conversations → recommendations → bookings) belongs to the end users, so the read is
 * cross-user but bounded to one expert; the service enforces that scope with explicit predicates.
 *
 * An admin may inspect any expert's portal by passing `expertId`; a non-admin expert is always
 * scoped to their own linked `Expert` row (the `expertId` param is ignored for them).
 */

// ── consultation conversions ───────────────────────────────────────────────

/** A consultation's lifecycle status (mirrors the `consultation_status` DB enum). */
export type ConsultationStatusValue =
  | "recommended"
  | "booked"
  | "confirmed"
  | "completed"
  | "canceled"
  | "no_show";

/** The user's response to a recommendation, including the not-yet-answered `pending` default. */
export type RecommendationFunnelResponse = RecommendationResponseValue | "pending";

/** One recent recommendation in the conversions feed (newest first). */
export interface ExpertConversionItemDto {
  /** The `consultation_recommendations` row id. */
  recommendationId: string;
  trigger: RecommendationTriggerValue;
  response: RecommendationFunnelResponse;
  /** The booked consultation's status, or null when the recommendation was never booked. */
  consultationStatus: ConsultationStatusValue | null;
  /** The consultation's amount in cents, or null when unpriced / not booked. */
  amountCents: number | null;
  /** ISO timestamp the recommendation was surfaced. */
  createdAt: string;
}

/**
 * The expert's consultation-conversion summary (`GET /expert/conversions`). Aggregates the funnel
 * for one expert's voice: recommendations by trigger and by response, the consultations they
 * produced by status, attributed booked revenue, and a recent feed. `expert` is null when the
 * caller isn't linked to an expert profile (or an admin passed no/unknown `expertId`) — every
 * count is then zero and the UI shows an empty-state note rather than an error.
 */
export interface ExpertConversionsDto {
  /** The expert this view is scoped to, or null when there is no resolvable expert. */
  expert: { id: string; displayName: string } | null;
  /** Total recommendations surfaced for this expert's conversations. */
  recommendationCount: number;
  /** Recommendations grouped by which trigger fired. */
  byTrigger: Record<RecommendationTriggerValue, number>;
  /** Recommendations grouped by the user's response (incl. not-yet-answered `pending`). */
  byResponse: Record<RecommendationFunnelResponse, number>;
  /** Consultations created from this expert's recommendations, grouped by status. */
  byConsultationStatus: Record<ConsultationStatusValue, number>;
  /** Booked-and-beyond consultation revenue attributed to this expert (cents). */
  revenueCents: number;
  /** The most-recent recommendations (newest first). */
  recent: ExpertConversionItemDto[];
}

// ── AI answer review ────────────────────────────────────────────────────────

/** Accidental-absurd-value guard, not a product limit. */
const MAX_ANSWER_PAGE = 100;

/**
 * Page query for the expert AI-answer review feed (`GET /expert/answers`). `expertId` lets an admin
 * target a specific expert; a non-admin expert is scoped to their own voice regardless of it.
 */
export const expertAnswerListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_ANSWER_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ExpertAnswerListQueryInput = z.infer<typeof expertAnswerListQuerySchema>;

/**
 * One AI answer rendered in the expert's voice, for review. Pairs the answer with the question that
 * prompted it (the most-recent user message at/before it) and the user's feedback verdict (👍/👎) so
 * the expert can spot weak answers. `insufficientKnowledge` is the deterministic empty-sources proxy
 * (mirrors the chat pipeline). `helpful`/`feedbackReason` are null when the user left no feedback.
 */
export interface ExpertAnswerReviewDto {
  messageId: string;
  conversationId: string;
  question: string | null;
  answer: string;
  model: string | null;
  confidence: number | null;
  insufficientKnowledge: boolean;
  helpful: boolean | null;
  feedbackReason: string | null;
  createdAt: string;
}

// ── per-expert calendar / TidyCal settings (M16) ────────────────────────────

/**
 * An expert's TidyCal calendar settings as surfaced to the portal. **Write-only token:** the API token
 * is never returned — only whether one is configured and a non-sensitive last-4 hint so the expert can
 * recognize which token is stored. TidyCal has no webhooks, so there is nothing else to configure;
 * booking sync polls `GET /bookings` with the stored token.
 */
export interface ExpertCalendarSettingsDto {
  /** Whether an encrypted TidyCal API token is stored for this expert. */
  apiTokenConfigured: boolean;
  /** Last 4 chars of the stored token ("••••1234"), or null when none is configured. */
  apiTokenLast4: string | null;
  /** The expert's public TidyCal booking URL (shown to consumers), or null. */
  tidycalLink: string | null;
}

/**
 * Update an expert's calendar settings (`PATCH /expert/calendar-settings`, admin
 * `PATCH /admin/experts/:id/calendar`). Every field is optional so a caller can change one without
 * touching the others. `apiToken`: a non-empty string sets/replaces it (stored encrypted); `null`
 * clears it; omitted leaves it. `tidycalLink`: a URL sets it; `null` or `""` clears it. The token is
 * write-only — it is accepted here but never read back.
 */
export const expertCalendarSettingsUpdateSchema = z
  .object({
    apiToken: z.string().trim().min(1).max(500).nullable().optional(),
    tidycalLink: z
      .union([z.string().trim().url().max(500), z.literal(""), z.null()])
      .optional(),
  })
  .strict();

export type ExpertCalendarSettingsUpdateInput = z.infer<
  typeof expertCalendarSettingsUpdateSchema
>;
