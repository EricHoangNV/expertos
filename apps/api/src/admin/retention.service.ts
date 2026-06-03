import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type { RetentionPreviewDto, RetentionSweepResultDto } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { STORAGE_PROVIDER } from "../uploads/upload.tokens";
import type { StorageProvider } from "../uploads/storage-provider";
import { deleteStorageObjects } from "../uploads/storage-cleanup";
import { AdminAuditService } from "./admin-audit.service";
import { RETENTION_POLICY, type RetentionPolicy } from "./retention.config";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sentinel an anonymized concierge answer is scrubbed to. Doubles as the idempotency marker: a
 * response whose `originalAnswer` already equals this is excluded from preview counts and skipped by
 * the sweep, so re-running never double-counts or re-touches a row.
 */
const REDACTED = "[redacted]";

/** Cutoff instants for one preview/sweep, computed once so preview and sweep agree. */
interface Cutoffs {
  /** "Now" — temporary uploads with `expiresAt` before this are past their stamped TTL. */
  now: Date;
  /** Conversations whose `updatedAt` is before this are idle past the retention window. */
  conversation: Date;
  /** Usage-log rows whose `occurredAt` is before this are past the analytics window. */
  usageLog: Date;
  /** Consultations dated before this have their transcript (`consultation_notes`) deleted. */
  consultationTranscript: Date;
  /** Concierge review responses created before this are anonymized in place. */
  conciergeRecord: Date;
}

/**
 * Data-retention sweeper (NT.3, PRD §"Non-Technical Requirements" → "Data-retention + deletion
 * policy"). This is the "a sweeper reclaims them" job the upload pipeline (M5.2) and the published
 * policy both reference: without it the auto-delete promise is aspirational and expired rows
 * accumulate forever. It deletes the three data classes with unambiguous, side-effect-free deletion
 * semantics, and additionally enforces the two policy classes that must keep their structural row
 * (see {@link import("@expertos/shared").RetentionCounts}): **consultation transcripts** are deleted
 * past 1 year from the consultation date while the parent `consultations` row (revenue/MRR) is kept,
 * and **concierge review records** are *anonymized* in place past 1 year (answer text + reviewer
 * notes scrubbed; the structural row that the M10.3 analytics read survives). Anonymization is
 * idempotent — an already-scrubbed response is skipped — so the sweep is safe to re-run.
 *
 * **Admin-triggered, not scheduled.** Consistent with PRD §"No full infra Day 1" (no in-app cron),
 * the sweep runs behind an admin route — point a Cloud Scheduler job at `POST /admin/retention/sweep`
 * to run it on a cadence. `preview` is a non-destructive dry run (counts only) so an operator can see
 * the blast radius before running it.
 *
 * Like every admin service it runs inside {@link RlsService.run} under the admin principal, so the
 * `is_admin` GUC grants the platform-wide (cross-tenant) reach a retention sweep needs (the RLS
 * policies are `FOR ALL` with an `is_admin()` bypass in both USING and WITH CHECK, so the cross-tenant
 * `deleteMany` is permitted). The `@Roles("admin")` route guard gates the caller. The sweep appends
 * one immutable {@link AdminAuditService} entry **in the same transaction** as the deletes, so the
 * record of what was purged is atomic with the purge.
 *
 * Deletes cascade at the database level (Postgres `ON DELETE CASCADE`): removing an `uploaded_files`
 * row drops its `upload_chunks`; removing a `conversation` drops its messages/citations/feedback/
 * saved-answers. `usage_logs` are leaf rows.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    private readonly logger: StructuredLogger,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(RETENTION_POLICY) private readonly policy: RetentionPolicy,
  ) {}

  /** Dry run: how many rows each category *would* affect right now. No writes, no audit entry. */
  async preview(actor: AuthUser): Promise<RetentionPreviewDto> {
    return this.rls.run(actor, async (tx) => {
      const cutoffs = this.cutoffs();
      const [
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
        consultationTranscripts,
        conciergeRecords,
      ] = await Promise.all([
        tx.uploadedFile.count({ where: expiredUploadWhere(cutoffs.now) }),
        tx.conversation.count({ where: { updatedAt: { lt: cutoffs.conversation } } }),
        tx.usageLog.count({ where: { occurredAt: { lt: cutoffs.usageLog } } }),
        tx.consultationNote.count({ where: expiredTranscriptWhere(cutoffs.consultationTranscript) }),
        tx.reviewResponse.count({ where: anonymizableReviewWhere(cutoffs.conciergeRecord) }),
      ]);
      return {
        asOf: cutoffs.now.toISOString(),
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
        consultationTranscripts,
        conciergeRecords,
      };
    });
  }

  /** Enforce every category (deletions + anonymization), audit the action, and report the counts. */
  async sweep(actor: AuthUser): Promise<RetentionSweepResultDto> {
    const { result, uploadUris } = await this.rls.run(actor, async (tx) => {
      const cutoffs = this.cutoffs();
      // Sequential (not Promise.all) so the writes share one well-defined order inside the tx.
      // Capture the raw-object URIs before the row delete drops them (`deleteMany` returns only a
      // count), so the post-commit cleanup can reclaim the GCS objects too (Security Cycle 2).
      const expiringUploads = await tx.uploadedFile.findMany({
        where: expiredUploadWhere(cutoffs.now),
        select: { gcsUri: true },
      });
      const temporaryUploads = (
        await tx.uploadedFile.deleteMany({ where: expiredUploadWhere(cutoffs.now) })
      ).count;
      const expiredConversations = (
        await tx.conversation.deleteMany({ where: { updatedAt: { lt: cutoffs.conversation } } })
      ).count;
      const oldUsageLogs = (
        await tx.usageLog.deleteMany({ where: { occurredAt: { lt: cutoffs.usageLog } } })
      ).count;
      // Delete the transcript (free-text notes) but keep the consultation row (revenue/MRR).
      const consultationTranscripts = (
        await tx.consultationNote.deleteMany({
          where: expiredTranscriptWhere(cutoffs.consultationTranscript),
        })
      ).count;
      // Anonymize-not-delete: scrub the answer text + notes, keep the structural row (M10.3 analytics).
      const conciergeRecords = (
        await tx.reviewResponse.updateMany({
          where: anonymizableReviewWhere(cutoffs.conciergeRecord),
          data: { originalAnswer: REDACTED, revisedAnswer: null, notes: null },
        })
      ).count;

      await this.audit.record(tx, actor, {
        action: "retention.swept",
        targetType: "retention",
        metadata: {
          temporaryUploads,
          expiredConversations,
          oldUsageLogs,
          consultationTranscripts,
          conciergeRecords,
          conversationDays: this.policy.conversationDays,
          usageLogDays: this.policy.usageLogDays,
          consultationTranscriptDays: this.policy.consultationTranscriptDays,
          conciergeRecordDays: this.policy.conciergeRecordDays,
        },
      });
      this.logger.info("retention sweep complete", {
        actorId: actor.id,
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
        consultationTranscripts,
        conciergeRecords,
      });
      return {
        result: {
          sweptAt: cutoffs.now.toISOString(),
          temporaryUploads,
          expiredConversations,
          oldUsageLogs,
          consultationTranscripts,
          conciergeRecords,
        } satisfies RetentionSweepResultDto,
        uploadUris: expiringUploads.map((u) => u.gcsUri),
      };
    });

    // Reclaim the raw upload objects now that their rows are committed gone (best-effort, non-fatal).
    await deleteStorageObjects(this.storage, uploadUris, this.logger, {
      job: "retention",
      actorId: actor.id,
    });
    return result;
  }

  /** Compute all cutoff instants from a single "now" so preview and sweep see the same boundaries. */
  private cutoffs(): Cutoffs {
    const nowMs = this.policy.now?.() ?? Date.now();
    return {
      now: new Date(nowMs),
      conversation: new Date(nowMs - this.policy.conversationDays * DAY_MS),
      usageLog: new Date(nowMs - this.policy.usageLogDays * DAY_MS),
      consultationTranscript: new Date(nowMs - this.policy.consultationTranscriptDays * DAY_MS),
      conciergeRecord: new Date(nowMs - this.policy.conciergeRecordDays * DAY_MS),
    };
  }
}

/**
 * `temporary` uploads past their stamped expiry. `expiresAt: { lt: now }` already excludes the
 * `null` (persistent — never expires) case, but `mode: "temporary"` is asserted too so a persistent
 * upload can never be swept even if a stray expiry were ever stamped on one.
 */
function expiredUploadWhere(now: Date): Prisma.UploadedFileWhereInput {
  return { mode: "temporary", expiresAt: { lt: now } };
}

/**
 * Consultation transcripts (`consultation_notes`) whose parent consultation is older than the cutoff.
 * "Consultation date" is `scheduledAt` when the consultation was actually booked, else `createdAt`
 * (a recommended-but-never-booked consultation). Filtering on the parent (not the note's own
 * `createdAt`) keeps the whole transcript's lifetime tied to the single consultation date the policy
 * names. The parent `consultations` row is untouched — only its notes are deleted.
 */
function expiredTranscriptWhere(cutoff: Date): Prisma.ConsultationNoteWhereInput {
  return {
    consultation: {
      OR: [{ scheduledAt: { lt: cutoff } }, { scheduledAt: null, createdAt: { lt: cutoff } }],
    },
  };
}

/**
 * Concierge review responses past the retention window that still carry their original text. The
 * `originalAnswer: { not: REDACTED }` predicate is the idempotency guard: once a row is scrubbed it
 * no longer matches, so previews don't over-count and re-running the sweep is a no-op for it.
 */
function anonymizableReviewWhere(cutoff: Date): Prisma.ReviewResponseWhereInput {
  return { createdAt: { lt: cutoff }, originalAnswer: { not: REDACTED } };
}
