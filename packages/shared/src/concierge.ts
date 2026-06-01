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
