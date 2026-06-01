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
