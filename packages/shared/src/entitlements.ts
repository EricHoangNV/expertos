/**
 * Entitlement / feature-gating contract (M6.1, PRD §"Paywall, Entitlements & Feature Gating").
 *
 * What's free vs paid is **configuration, not code**: the DB `plan_entitlements` matrix (seeded from
 * a code default, then admin-editable) is the runtime source of truth. These types are only the
 * wire/decorator contract shared by the API and its clients.
 */

import { z } from "zod";

/**
 * The entitlement-catalog feature keys — one per gated capability. Kept in lockstep with the
 * catalog default in `packages/db/prisma/seed.ts` (the seed populates the DB; the DB is authoritative
 * at runtime). The `@RequiresEntitlement(...)` decorator is typed against this union so a gated route
 * can only name a known capability.
 */
export type FeatureKey =
  | "ask_question"
  | "document_upload"
  | "all_expert_voices"
  | "cited_answers"
  | "saved_answers"
  | "concierge_review"
  | "consultation_booking";

/** The plan the acting user's entitlements resolve from (their active subscription, else Free). */
interface PlanSummary {
  key: string;
  name: string;
}

/**
 * One feature's entitlement for the acting user's current plan, as returned by `/me/entitlements`.
 * Metered features carry the live `used`/`remaining` quota so the usage indicator can show the wall
 * before it is hit; boolean features omit the metered fields.
 */
export interface EntitlementView {
  key: string;
  name: string;
  type: "boolean" | "metered";
  /** Whether the plan grants the capability at all. */
  enabled: boolean;
  /** Metered only: the hard cap per window, or `null` when there is no hard cap. */
  limit?: number | null;
  /**
   * Metered only: the fair-use soft threshold (M6.3). Past it the answer degrades to a cheaper
   * model instead of blocking; `null` when the feature has no degradation. The usage meter draws
   * its `.bar.warn` band from this so an unlimited-but-fair-use plan still shows a wall approaching.
   */
  softLimit?: number | null;
  /** Metered only: the rolling window the cap applies to. */
  window?: "day" | "week" | "month" | null;
  /** Metered only: count consumed in the current window. */
  used?: number;
  /** Metered only: `limit - used` (never negative), or `null` when there is no hard cap. */
  remaining?: number | null;
}

/**
 * The `/me/entitlements` response — powers the transparent usage indicator (M6.3) so a quota wall is
 * never a surprise mid-task.
 */
export interface EntitlementsDto {
  plan: PlanSummary;
  features: EntitlementView[];
}

/** An upgrade target offered in a 402 payload (a plan above the current tier that grants the feature). */
interface UpgradeOption {
  key: string;
  name: string;
}

/**
 * The body of a `402 Payment Required` response when a gated route is blocked (PRD §"Paywall flow").
 * The frontend renders an upgrade modal from it. Thrown as an `HttpException` object response, so it
 * arrives flat on the error body alongside `statusCode`/`requestId`.
 */
export interface EntitlementDeniedPayload {
  /** Why the gate blocked: the boolean feature is off, or a metered cap was reached. */
  reason: "feature_disabled" | "quota_exceeded";
  feature: string;
  currentPlan: string;
  upgradeOptions: UpgradeOption[];
  /** Remaining quota for a metered feature (0 at the wall); `null` for a boolean feature. */
  remainingQuota: number | null;
}

// ── M8.3 — admin plan-entitlement matrix editor ────────────────────────────

/**
 * The metered window a quota applies to (mirrors the DB `usage_window` enum). Only meaningful for a
 * metered feature; a boolean feature always carries `null`.
 */
export const usageWindowSchema = z.enum(["day", "week", "month"]);
export type UsageWindowValue = z.infer<typeof usageWindowSchema>;

/** Upper bound on an editable quota — a guard against an accidental absurd cap, not a product limit. */
const MAX_QUOTA = 1_000_000;

/**
 * The editable cell of the plan-entitlement matrix (`PATCH /admin/entitlements/:planId/features/:featureId`).
 * Identity (`planId`/`featureId`) is carried in the path, never the body, so it can't be reassigned
 * (directive §4.7 — freeze identity on update). The metered fields (`limit`/`softLimit`/`window`)
 * default to `null` when omitted and are forced to `null` server-side for a boolean feature; the
 * service rejects an incoherent metered config (e.g. `softLimit >= limit`, or a quota with no window).
 */
export const entitlementUpdateSchema = z.object({
  /** Whether the plan grants the capability at all. */
  enabled: z.boolean(),
  /** Metered hard cap per window (`null` = no hard cap). */
  limit: z.number().int().min(0).max(MAX_QUOTA).nullable().default(null),
  /** Metered fair-use soft threshold — degrade past it (`null` = no degradation). */
  softLimit: z.number().int().min(0).max(MAX_QUOTA).nullable().default(null),
  /** The rolling window a metered quota applies to (`null` = none). */
  window: usageWindowSchema.nullable().default(null),
});
export type EntitlementUpdateInput = z.infer<typeof entitlementUpdateSchema>;

/** One feature in the editable matrix (a matrix row). */
export interface EntitlementMatrixFeatureDto {
  id: string;
  key: string;
  name: string;
  type: "boolean" | "metered";
}

/** One plan in the editable matrix (a matrix column), lowest tier first. */
export interface EntitlementMatrixPlanDto {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

/** One (plan, feature) entitlement cell. Metered fields are `null` for a boolean feature. */
export interface EntitlementCellDto {
  planId: string;
  featureId: string;
  enabled: boolean;
  limit: number | null;
  softLimit: number | null;
  window: UsageWindowValue | null;
}

/**
 * The full plan-entitlement matrix (`GET /admin/entitlements`) the admin editor renders: every plan ×
 * every feature, plus the entitlement cell for each populated (plan, feature) pair. A pair with no
 * stored row is absent from `cells` (the editor renders it as a disabled default until first saved).
 */
export interface EntitlementMatrixDto {
  plans: EntitlementMatrixPlanDto[];
  features: EntitlementMatrixFeatureDto[];
  cells: EntitlementCellDto[];
}
