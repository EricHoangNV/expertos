import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type { RetentionPreviewDto, RetentionSweepResultDto } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { AdminAuditService } from "./admin-audit.service";
import { RETENTION_POLICY, type RetentionPolicy } from "./retention.config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cutoff instants for one preview/sweep, computed once so preview and sweep agree. */
interface Cutoffs {
  /** "Now" — temporary uploads with `expiresAt` before this are past their stamped TTL. */
  now: Date;
  /** Conversations whose `updatedAt` is before this are idle past the retention window. */
  conversation: Date;
  /** Usage-log rows whose `occurredAt` is before this are past the analytics window. */
  usageLog: Date;
}

/**
 * Data-retention sweeper (NT.3, PRD §"Non-Technical Requirements" → "Data-retention + deletion
 * policy"). This is the "a sweeper reclaims them" job the upload pipeline (M5.2) and the published
 * policy both reference: without it the auto-delete promise is aspirational and expired rows
 * accumulate forever. It deletes the three data classes with unambiguous, side-effect-free deletion
 * semantics (see {@link import("@expertos/shared").RetentionCounts}); consultation-transcript
 * expiry and concierge-record anonymization are deliberately out of scope (anonymize-not-delete /
 * revenue-integrity, handled separately).
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
    @Inject(RETENTION_POLICY) private readonly policy: RetentionPolicy,
  ) {}

  /** Dry run: how many rows each category *would* delete right now. No writes, no audit entry. */
  async preview(actor: AuthUser): Promise<RetentionPreviewDto> {
    return this.rls.run(actor, async (tx) => {
      const cutoffs = this.cutoffs();
      const [temporaryUploads, expiredConversations, oldUsageLogs] = await Promise.all([
        tx.uploadedFile.count({ where: expiredUploadWhere(cutoffs.now) }),
        tx.conversation.count({ where: { updatedAt: { lt: cutoffs.conversation } } }),
        tx.usageLog.count({ where: { occurredAt: { lt: cutoffs.usageLog } } }),
      ]);
      return {
        asOf: cutoffs.now.toISOString(),
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
      };
    });
  }

  /** Delete every expired row across the three categories, audit the action, and report the counts. */
  async sweep(actor: AuthUser): Promise<RetentionSweepResultDto> {
    return this.rls.run(actor, async (tx) => {
      const cutoffs = this.cutoffs();
      // Sequential (not Promise.all) so the deletes share one well-defined order inside the tx.
      const temporaryUploads = (
        await tx.uploadedFile.deleteMany({ where: expiredUploadWhere(cutoffs.now) })
      ).count;
      const expiredConversations = (
        await tx.conversation.deleteMany({ where: { updatedAt: { lt: cutoffs.conversation } } })
      ).count;
      const oldUsageLogs = (
        await tx.usageLog.deleteMany({ where: { occurredAt: { lt: cutoffs.usageLog } } })
      ).count;

      await this.audit.record(tx, actor, {
        action: "retention.swept",
        targetType: "retention",
        metadata: {
          temporaryUploads,
          expiredConversations,
          oldUsageLogs,
          conversationDays: this.policy.conversationDays,
          usageLogDays: this.policy.usageLogDays,
        },
      });
      this.logger.info("retention sweep complete", {
        actorId: actor.id,
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
      });
      return {
        sweptAt: cutoffs.now.toISOString(),
        temporaryUploads,
        expiredConversations,
        oldUsageLogs,
      };
    });
  }

  /** Compute all cutoff instants from a single "now" so preview and sweep see the same boundaries. */
  private cutoffs(): Cutoffs {
    const nowMs = this.policy.now?.() ?? Date.now();
    return {
      now: new Date(nowMs),
      conversation: new Date(nowMs - this.policy.conversationDays * DAY_MS),
      usageLog: new Date(nowMs - this.policy.usageLogDays * DAY_MS),
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
