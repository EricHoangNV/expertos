import { z } from "zod";
import { roleSchema, type Role } from "./roles";

/**
 * Admin portal management wire types (M8.4, PRD §"Admin web portal" → "Manage users,
 * subscriptions, fair-use flags" + §"Foundational security/privacy"). These cover the three M8.4
 * surfaces an admin operates over the platform population:
 *
 *  - **Audit log** — the immutable record of every admin mutation (role change, fair-use flag,
 *    deletion). Read-only on the wire; entries are appended server-side alongside the action.
 *  - **User / subscription management** — list + detail (the subscription, activity counts, and
 *    fair-use flags) + the levers an admin pulls: change a role, raise/resolve a fair-use flag.
 *  - **User-data deletion** — the GDPR request workflow + the destructive execution (directive
 *    "delete ALL user data on account deletion").
 *
 * All of these read/write across tenants under the admin RLS context, so they live behind
 * `@Roles("admin")`; nothing here is consumer-facing.
 */

/** Shared pagination for the admin list endpoints (coerced from query strings, capped). */
const ADMIN_LIST_PAGINATION = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

// ── Audit log ───────────────────────────────────────────────────────────────

/** Trailing audit-log query, optionally narrowed to one action / target type, newest first. */
export const adminAuditListQuerySchema = z.object({
  ...ADMIN_LIST_PAGINATION,
  action: z.string().trim().min(1).max(120).optional(),
  targetType: z.string().trim().min(1).max(60).optional(),
});
export type AdminAuditListQueryInput = z.infer<typeof adminAuditListQuerySchema>;

/** One immutable admin-action audit entry (actor resolved to email/name for display). */
export interface AdminAuditLogDto {
  id: string;
  /** The acting admin's user id, or null if that account was since deleted (FK SetNull). */
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  /** The action verb, e.g. `user.role_changed` / `user.data_deleted`. */
  action: string;
  /** The kind of entity acted on (`user`, `fair_use_flag`, …), or null. */
  targetType: string | null;
  /** The acted-on entity's id (a plain string — kept even after the row is deleted). */
  targetId: string | null;
  /** Non-PII structured context (`{ from, to }` for a role change, …), or null. */
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── Fair-use flags ───────────────────────────────────────────────────────────

export const FAIR_USE_FLAG_STATUSES = ["open", "reviewed", "throttled", "cleared"] as const;
export const fairUseFlagStatusSchema = z.enum(FAIR_USE_FLAG_STATUSES);
export type FairUseFlagStatusValue = z.infer<typeof fairUseFlagStatusSchema>;

/** Raise a fair-use / abuse flag against a user (the reason is an admin note). */
export const fairUseFlagCreateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type FairUseFlagCreateInput = z.infer<typeof fairUseFlagCreateSchema>;

/** Move a flag through its review lifecycle (open → reviewed/throttled/cleared). */
export const fairUseFlagUpdateSchema = z.object({
  status: fairUseFlagStatusSchema,
});
export type FairUseFlagUpdateInput = z.infer<typeof fairUseFlagUpdateSchema>;

export interface AdminFairUseFlagDto {
  id: string;
  reason: string;
  status: FairUseFlagStatusValue;
  createdAt: string;
}

// ── User-data deletion ────────────────────────────────────────────────────────

export const DATA_DELETION_STATUSES = ["requested", "processing", "completed", "failed"] as const;
export const dataDeletionStatusSchema = z.enum(DATA_DELETION_STATUSES);
export type DataDeletionStatusValue = z.infer<typeof dataDeletionStatusSchema>;

/** A recorded user-data deletion request (the workflow state before/around the destructive op). */
export interface DataDeletionRequestDto {
  id: string;
  userId: string;
  status: DataDeletionStatusValue;
  requestedAt: string;
  completedAt: string | null;
}

/** The result of the destructive deletion — the user row and all owned data are gone (cascade). */
export interface UserDeletionResultDto {
  userId: string;
  deleted: true;
}

// ── Users / subscriptions ──────────────────────────────────────────────────────

/** Trailing user list, optionally narrowed by role and/or an email/name substring. */
export const adminUserListQuerySchema = z.object({
  ...ADMIN_LIST_PAGINATION,
  role: roleSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type AdminUserListQueryInput = z.infer<typeof adminUserListQuerySchema>;

/** Change a user's RBAC role. */
export const adminUserRoleUpdateSchema = z.object({
  role: roleSchema,
});
export type AdminUserRoleUpdateInput = z.infer<typeof adminUserRoleUpdateSchema>;

/** One user in the management list, with the plan/status of their most-recent subscription. */
export interface AdminUserSummaryDto {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  /** The plan key of the most-recent subscription, or null (never subscribed = effectively Free). */
  planKey: string | null;
  /** The status of that subscription, or null. */
  subscriptionStatus: string | null;
  createdAt: string;
}

/** The most-recent subscription on a user's detail view (provider remains the billing source of truth). */
export interface AdminUserSubscriptionDto {
  id: string;
  planKey: string;
  planName: string;
  interval: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
}

/** Lightweight engagement counts on the user detail view. */
export interface AdminUserActivityDto {
  conversationCount: number;
  uploadCount: number;
  consultationCount: number;
}

/** Full user detail: identity + subscription + activity + open fair-use flags + any deletion request. */
export interface AdminUserDetailDto {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  locale: string;
  createdAt: string;
  updatedAt: string;
  subscription: AdminUserSubscriptionDto | null;
  activity: AdminUserActivityDto;
  fairUseFlags: AdminFairUseFlagDto[];
  deletion: DataDeletionRequestDto | null;
}
