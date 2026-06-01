import { z } from "zod";

/**
 * Failed / low-confidence query inspector wire types (M8.3, PRD §"Admin" → "failed/low-confidence
 * query inspector"). The admin portal reads a platform-wide, **read-only** feed of the answers users
 * marked unhelpful (👎), so an expert can triage weak answers and feed them back into knowledge.
 *
 * The source is `answer_feedback` (the `helpful = false` rows); each row is joined to its rated
 * assistant `messages` row for the answer text + model/confidence + the insufficient-knowledge
 * signal (no retrieved sources), and back to the preceding `user` message for the original question.
 * Cross-tenant: the admin RLS context grants the platform-wide read (no `tenant_id` predicate).
 */

/** Trailing list query: a page of the most-recent negative-feedback rows, newest first. */
export const failedQueryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FailedQueryListQueryInput = z.infer<typeof failedQueryListQuerySchema>;

/**
 * One unhelpful-rated answer the inspector surfaces: the original question, the answer that drew the
 * 👎, the user's stated reason (if any), and the answer's quality signals (`model`, `confidence`,
 * and `insufficientKnowledge` — true when the answer was generated with zero retrieved sources, the
 * deterministic "the model had nothing to ground on" proxy).
 */
export interface FailedQueryDto {
  /** The `answer_feedback` row id. */
  feedbackId: string;
  /** The rated assistant message. */
  messageId: string;
  /** The conversation the answer belongs to. */
  conversationId: string;
  /** The user's question (the most recent user message at/before the answer), or null if none. */
  question: string | null;
  /** The assistant answer that drew the 👎. */
  answer: string;
  /** The user's free-text reason for the 👎, or null when they gave none. */
  reason: string | null;
  /** The model that produced the answer, or null when unrecorded. */
  model: string | null;
  /** The answer's recorded confidence, or null when unrecorded. */
  confidence: number | null;
  /** True when the answer cited zero sources (the insufficient-knowledge / failed-retrieval signal). */
  insufficientKnowledge: boolean;
  /** When the user submitted the feedback (UTC ISO). */
  createdAt: string;
}
