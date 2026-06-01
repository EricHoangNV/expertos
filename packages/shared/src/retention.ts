/**
 * Data-retention sweep wire types (NT.3, PRD §"Non-Technical Requirements" → "Data-retention +
 * deletion policy"). The published policy promises that several data classes are **auto-deleted**
 * once past their retention window; this is the contract for the admin-triggered sweeper that makes
 * that promise true (until then the rows accumulate and the policy is aspirational).
 *
 * Five categories are enforced here. Three are outright **deletions** with unambiguous,
 * side-effect-free semantics:
 *
 *  - **temporary uploads** — query-time `temporary` uploads past their stamped `expiresAt` (M5.2).
 *    The stamped expiry is authoritative, so this is decoupled from the retention-days constant.
 *  - **idle conversations** — conversation history untouched for the retention window (cascades to
 *    messages / citations / feedback / saved answers).
 *  - **old usage logs** — aggregated usage/analytics rows past the analytics retention window.
 *
 * Two more honour the policy's distinction for records that carry value beyond their free text, so
 * the structural/revenue rows survive while the personal content is removed:
 *
 *  - **consultation transcripts** — `consultation_notes` past 1 year from the consultation date are
 *    deleted, but the parent `consultations` row (status / amount / booking) is **kept** so historical
 *    revenue / MRR reporting is undistorted.
 *  - **concierge review records** — `review_responses` past 1 year are **anonymized** (the answer text
 *    and reviewer notes are scrubbed) while the structural row (verdict / timing / SLA) survives so the
 *    M10.3 concierge analytics stay intact. This is the policy's "anonymized after retention" line.
 */

/** Per-category row counts for one sweep (or a dry-run preview). */
export interface RetentionCounts {
  /** `temporary` uploaded files past their stamped `expiresAt` (chunks cascade). */
  temporaryUploads: number;
  /** Conversations whose last activity (`updatedAt`) predates the retention window. */
  expiredConversations: number;
  /** Usage-log rows whose `occurredAt` predates the analytics retention window. */
  oldUsageLogs: number;
  /** `consultation_notes` past 1yr from the consultation date — deleted (the `consultations` row stays). */
  consultationTranscripts: number;
  /** `review_responses` past 1yr — anonymized in place (answer text + notes scrubbed; row survives). */
  conciergeRecords: number;
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
