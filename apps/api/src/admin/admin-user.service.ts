import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type {
  AdminFairUseFlagDto,
  AdminUserDetailDto,
  AdminUserListQueryInput,
  AdminUserRoleUpdateInput,
  AdminUserSummaryDto,
  DataDeletionRequestDto,
  FairUseFlagCreateInput,
  FairUseFlagStatusValue,
  FairUseFlagUpdateInput,
  Role,
  UserDeletionResultDto,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { AdminAuditService } from "./admin-audit.service";

/** `select` for the management list row → {@link AdminUserSummaryDto}. */
const SUMMARY_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  createdAt: true,
  subscriptions: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, plan: { select: { key: true } } },
  },
} satisfies Prisma.UserSelect;

interface SummaryRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  createdAt: Date;
  subscriptions: { status: string; plan: { key: string } }[];
}

/** `select` for the detail view → {@link AdminUserDetailDto}. */
const DETAIL_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
  subscriptions: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      interval: true,
      status: true,
      currentPeriodEnd: true,
      cancelAt: true,
      plan: { select: { key: true, name: true } },
    },
  },
  fairUseFlags: {
    orderBy: { createdAt: "desc" },
    select: { id: true, reason: true, status: true, createdAt: true },
  },
  dataDeletionRequests: {
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: { id: true, userId: true, status: true, requestedAt: true, completedAt: true },
  },
  _count: { select: { conversations: true, uploadedFiles: true, consultations: true } },
} satisfies Prisma.UserSelect;

interface SubscriptionRow {
  id: string;
  interval: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  plan: { key: string; name: string };
}

interface FairUseRow {
  id: string;
  reason: string;
  status: string;
  createdAt: Date;
}

interface DeletionRow {
  id: string;
  userId: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
}

interface DetailRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  subscriptions: SubscriptionRow[];
  fairUseFlags: FairUseRow[];
  dataDeletionRequests: DeletionRow[];
  _count: { conversations: number; uploadedFiles: number; consultations: number };
}

/** `select` for a fair-use flag → {@link AdminFairUseFlagDto}. */
const FLAG_SELECT = {
  id: true,
  reason: true,
  status: true,
  createdAt: true,
} satisfies Prisma.FairUseFlagSelect;

/**
 * Admin user / subscription / fair-use management + user-data deletion (M8.4, PRD §"Admin web
 * portal" → "Manage users, subscriptions, fair-use flags" + §"Foundational security/privacy" →
 * "User data deletion").
 *
 * Every read/write runs inside {@link RlsService.run} under the admin principal, so the `is_admin`
 * GUC grants platform-wide (cross-tenant) visibility — the same pattern as the other admin services;
 * the `@Roles("admin")` route guard gates the caller. Every **mutation** appends an immutable
 * {@link AdminAuditService} entry **in the same transaction**, so an action and its audit record are
 * atomic.
 *
 * Subscriptions are **read-only** here on purpose: the payment provider is the billing source of
 * truth (directive — only the webhook writes authoritative subscription status), so the admin sees a
 * user's subscription but does not mutate it; plan/cancellation changes flow through the
 * provider/billing path. The management levers M8.4 exposes are role and fair-use flags.
 *
 * **User-data deletion** is the destructive GDPR op (directive "delete ALL user data on account
 * deletion"): `executeDeletion` hard-deletes the `users` row, and Postgres `ON DELETE CASCADE`
 * removes every owned row (conversations/messages, uploads, subscriptions, usage, consultations, the
 * deletion-request rows themselves, …) atomically. The audit entry is written *before* the delete so
 * it survives the cascade (`admin_audit_logs` is tenant-scoped with an actor `SetNull`, so it is the
 * durable proof the deletion happened). An `experts` row linked to the user has its `user_id`
 * `SetNull`'d — the expert's published knowledge/voice outlives the operator account by design.
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly rls: RlsService,
    private readonly audit: AdminAuditService,
    private readonly logger: StructuredLogger,
  ) {}

  /** A page of users, newest first; optionally narrowed by role and/or an email/name substring. */
  async list(user: AuthUser, query: AdminUserListQueryInput): Promise<AdminUserSummaryDto[]> {
    return this.rls.run(user, async (tx) => {
      const where: Prisma.UserWhereInput = {};
      if (query.role) {
        where.role = query.role;
      }
      if (query.search) {
        where.OR = [
          { email: { contains: query.search, mode: "insensitive" } },
          { displayName: { contains: query.search, mode: "insensitive" } },
        ];
      }
      const rows = (await tx.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: SUMMARY_SELECT,
      })) as SummaryRow[];
      return rows.map(toSummary);
    });
  }

  /** One user's full detail: identity, subscription, activity counts, fair-use flags, deletion. */
  async get(user: AuthUser, userId: string): Promise<AdminUserDetailDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.user.findUnique({
        where: { id: userId },
        select: DETAIL_SELECT,
      })) as DetailRow | null;
      if (!row) {
        throw new NotFoundException("user not found");
      }
      return toDetail(row);
    });
  }

  /** Change a user's role. An admin cannot change their own role (self-lockout guard). */
  async updateRole(
    actor: AuthUser,
    userId: string,
    input: AdminUserRoleUpdateInput,
  ): Promise<AdminUserSummaryDto> {
    if (actor.id === userId) {
      throw new BadRequestException("cannot change your own role");
    }
    return this.rls.run(actor, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!current) {
        throw new NotFoundException("user not found");
      }
      const row = (await tx.user.update({
        where: { id: userId },
        data: { role: input.role },
        select: SUMMARY_SELECT,
      })) as SummaryRow;
      await this.audit.record(tx, actor, {
        action: "user.role_changed",
        targetType: "user",
        targetId: userId,
        metadata: { from: current.role, to: input.role },
      });
      return toSummary(row);
    });
  }

  /** Raise a fair-use / abuse flag against a user. */
  async flagFairUse(
    actor: AuthUser,
    userId: string,
    input: FairUseFlagCreateInput,
  ): Promise<AdminFairUseFlagDto> {
    return this.rls.run(actor, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, tenantId: true },
      });
      if (!target) {
        throw new NotFoundException("user not found");
      }
      const flag = (await tx.fairUseFlag.create({
        data: {
          tenantId: target.tenantId,
          userId,
          reason: input.reason,
          status: "open",
        },
        select: FLAG_SELECT,
      })) as FairUseRow;
      await this.audit.record(tx, actor, {
        action: "user.fair_use_flagged",
        targetType: "user",
        targetId: userId,
        metadata: { flagId: flag.id },
      });
      return toFlag(flag);
    });
  }

  /** Move a fair-use flag through its review lifecycle. */
  async updateFairUseFlag(
    actor: AuthUser,
    flagId: string,
    input: FairUseFlagUpdateInput,
  ): Promise<AdminFairUseFlagDto> {
    return this.rls.run(actor, async (tx) => {
      const existing = await tx.fairUseFlag.findUnique({
        where: { id: flagId },
        select: { id: true, userId: true },
      });
      if (!existing) {
        throw new NotFoundException("fair-use flag not found");
      }
      const flag = (await tx.fairUseFlag.update({
        where: { id: flagId },
        data: { status: input.status },
        select: FLAG_SELECT,
      })) as FairUseRow;
      await this.audit.record(tx, actor, {
        action: "user.fair_use_updated",
        targetType: "fair_use_flag",
        targetId: flagId,
        metadata: { userId: existing.userId, status: input.status },
      });
      return toFlag(flag);
    });
  }

  /** Record a user-data deletion request (the workflow row, before the destructive execution). */
  async requestDeletion(actor: AuthUser, userId: string): Promise<DataDeletionRequestDto> {
    return this.rls.run(actor, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, tenantId: true },
      });
      if (!target) {
        throw new NotFoundException("user not found");
      }
      const req = (await tx.dataDeletionRequest.create({
        data: { tenantId: target.tenantId, userId, status: "requested" },
        select: {
          id: true,
          userId: true,
          status: true,
          requestedAt: true,
          completedAt: true,
        },
      })) as DeletionRow;
      await this.audit.record(tx, actor, {
        action: "user.deletion_requested",
        targetType: "user",
        targetId: userId,
        metadata: { requestId: req.id },
      });
      return toDeletion(req);
    });
  }

  /**
   * Hard-delete a user and all their owned data (the cascade). An admin cannot delete their own
   * account (self-lockout guard). The audit entry is written first so it survives the cascade.
   */
  async executeDeletion(actor: AuthUser, userId: string): Promise<UserDeletionResultDto> {
    if (actor.id === userId) {
      throw new BadRequestException("cannot delete your own account");
    }
    return this.rls.run(actor, async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!target) {
        throw new NotFoundException("user not found");
      }
      await this.audit.record(tx, actor, {
        action: "user.data_deleted",
        targetType: "user",
        targetId: userId,
        metadata: { role: target.role },
      });
      await tx.user.delete({ where: { id: userId } });
      this.logger.info("user data deleted", { userId, actorId: actor.id });
      return { userId, deleted: true };
    });
  }
}

/** Flatten a {@link SUMMARY_SELECT} row into {@link AdminUserSummaryDto}. */
function toSummary(row: SummaryRow): AdminUserSummaryDto {
  const sub = row.subscriptions[0] ?? null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Role,
    planKey: sub?.plan.key ?? null,
    subscriptionStatus: sub?.status ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Flatten a {@link DETAIL_SELECT} row into {@link AdminUserDetailDto}. */
function toDetail(row: DetailRow): AdminUserDetailDto {
  const sub = row.subscriptions[0] ?? null;
  const deletion = row.dataDeletionRequests[0] ?? null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Role,
    locale: row.locale,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    subscription:
      sub === null
        ? null
        : {
            id: sub.id,
            planKey: sub.plan.key,
            planName: sub.plan.name,
            interval: sub.interval,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
            cancelAt: sub.cancelAt?.toISOString() ?? null,
          },
    activity: {
      conversationCount: row._count.conversations,
      uploadCount: row._count.uploadedFiles,
      consultationCount: row._count.consultations,
    },
    fairUseFlags: row.fairUseFlags.map(toFlag),
    deletion: deletion === null ? null : toDeletion(deletion),
  };
}

/** Flatten a {@link FLAG_SELECT} row into {@link AdminFairUseFlagDto}. */
function toFlag(row: FairUseRow): AdminFairUseFlagDto {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status as FairUseFlagStatusValue,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Flatten a deletion-request row into {@link DataDeletionRequestDto}. */
function toDeletion(row: DeletionRow): DataDeletionRequestDto {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as DataDeletionRequestDto["status"],
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
