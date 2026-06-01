/**
 * Data-retention sweep wire types (NT.3, PRD §"Non-Technical Requirements" → "Data-retention +
 * deletion policy"). The published policy promises that several data classes are **auto-deleted**
 * once past their retention window; this is the contract for the admin-triggered sweeper that makes
 * that promise true (until then the rows accumulate and the policy is aspirational).
 *
 * Three categories are enforced here — the ones with unambiguous, side-effect-free deletion
 * semantics:
 *
 *  - **temporary uploads** — query-time `temporary` uploads past their stamped `expiresAt` (M5.2).
 *    The stamped expiry is authoritative, so this is decoupled from the retention-days constant.
 *  - **idle conversations** — conversation history untouched for the retention window (cascades to
 *    messages / citations / feedback / saved answers).
 *  - **old usage logs** — aggregated usage/analytics rows past the analytics retention window.
 *
 * Consultation-transcript expiry and concierge-record *anonymization* are intentionally **not** here:
 * the policy calls for anonymize-not-delete on concierge records and deleting consultations would
 * distort historical revenue/MRR reporting, so they need their own (non-deletion) treatment.
 */

/** Per-category row counts for one sweep (or a dry-run preview). */
export interface RetentionCounts {
  /** `temporary` uploaded files past their stamped `expiresAt` (chunks cascade). */
  temporaryUploads: number;
  /** Conversations whose last activity (`updatedAt`) predates the retention window. */
  expiredConversations: number;
  /** Usage-log rows whose `occurredAt` predates the analytics retention window. */
  oldUsageLogs: number;
}

/** Dry-run preview: how many rows *would* be deleted right now, per category. No writes. */
export interface RetentionPreviewDto extends RetentionCounts {
  /** The instant the cutoffs were computed against (ISO-8601). */
  asOf: string;
}

/** The result of a sweep: how many rows were deleted, per category. */
export interface RetentionSweepResultDto extends RetentionCounts {
  /** The instant the sweep ran (ISO-8601). */
  sweptAt: string;
}
