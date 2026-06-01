import { Injectable } from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type { AdminAuditListQueryInput, AdminAuditLogDto } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** A single audit entry to append. The actor is taken from the acting principal, not the caller. */
interface AuditEntry {
  /** The action verb, e.g. `user.role_changed`. */
  action: string;
  /** The kind of entity acted on (`user`, `fair_use_flag`, …). */
  targetType?: string;
  /** The acted-on entity's id. */
  targetId?: string;
  /** Non-PII structured context. Never put raw email/token/secret here (this does not redact). */
  metadata?: Record<string, unknown>;
}

/** Prisma `select` that yields exactly an {@link AdminAuditLogDto} (plus the resolved actor). */
const AUDIT_SELECT = {
  id: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { email: true, displayName: true } },
} satisfies Prisma.AdminAuditLogSelect;

/** The row shape {@link AUDIT_SELECT} returns. */
interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actor: { email: string; displayName: string | null } | null;
}

/**
 * The immutable admin-action audit log (M8.4, PRD §"Foundational security/privacy" → "audit logs
 * for admin & expert actions"). The single choke point for both writing and reading audit entries.
 *
 * `record` appends an entry **inside the caller's transaction**, so the log row commits atomically
 * with the action it records (or rolls back with it) — there is no way to perform a mutation without
 * its audit entry, or vice versa. The log is append-only: there is no update/delete path.
 *
 * `list` reads cross-tenant under the admin RLS context (the `is_admin` GUC), the same platform-wide
 * pattern {@link RevenueService} / {@link FailedQueryService} use; the `@Roles("admin")` route guard
 * is what guarantees the caller is actually an admin.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly rls: RlsService) {}

  /**
   * Append an audit entry within `tx` (the transaction of the action being recorded). The actor is
   * stamped from the acting admin; the log row's tenant is the actor's home tenant.
   */
  async record(tx: Prisma.TransactionClient, actor: AuthUser, entry: AuditEntry): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /** A page of audit entries, newest first; optionally narrowed by action / target type. */
  async list(user: AuthUser, query: AdminAuditListQueryInput): Promise<AdminAuditLogDto[]> {
    return this.rls.run(user, async (tx) => {
      const where: Prisma.AdminAuditLogWhereInput = {};
      if (query.action) {
        where.action = query.action;
      }
      if (query.targetType) {
        where.targetType = query.targetType;
      }
      const rows = (await tx.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: AUDIT_SELECT,
      })) as AuditRow[];
      return rows.map(toAuditDto);
    });
  }
}

/** Flatten an {@link AUDIT_SELECT} row into the public {@link AdminAuditLogDto}. */
function toAuditDto(row: AuditRow): AdminAuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actor?.email ?? null,
    actorName: row.actor?.displayName ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
