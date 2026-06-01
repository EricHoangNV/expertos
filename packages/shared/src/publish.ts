import { z } from "zod";

/**
 * The shared publish lifecycle (`publish_status` enum in the DB). It governs both the
 * versioned-knowledge gate (M8) and the expert voice-profile sign-off workflow (M2.3):
 * a profile is authored as a `draft`, submitted to `expert_review`, then `published` on
 * expert sign-off (`archived` retires it). `ai_processing` is reserved for the knowledge
 * pipeline and is not a state the voice workflow transitions through.
 */
export const PUBLISH_STATUSES = [
  "draft",
  "ai_processing",
  "expert_review",
  "published",
  "archived",
] as const;

export const publishStatusSchema = z.enum(PUBLISH_STATUSES);

export type PublishStatusValue = z.infer<typeof publishStatusSchema>;
