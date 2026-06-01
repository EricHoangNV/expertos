/**
 * Entitlement / feature-gating contract (M6.1, PRD §"Paywall, Entitlements & Feature Gating").
 *
 * What's free vs paid is **configuration, not code**: the DB `plan_entitlements` matrix (seeded from
 * a code default, then admin-editable) is the runtime source of truth. These types are only the
 * wire/decorator contract shared by the API and its clients.
 */

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
