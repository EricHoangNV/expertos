import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  EntitlementDeniedPayload,
  EntitlementView,
  EntitlementsDto,
  FeatureKey,
} from "@expertos/shared";
import type { Prisma, UsageWindow } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/** The active subscription statuses that grant a paid plan (others fall back to Free). */
const LIVE_STATUSES = ["active", "trialing"] as const;

/** The Free plan key — the default entitlement set for a user with no live subscription. */
const FREE_PLAN_KEY = "free";

/** The minimal plan shape the service resolves the acting user's entitlements from. */
interface ResolvedPlan {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
}

const PLAN_SELECT = {
  id: true,
  key: true,
  name: true,
  sortOrder: true,
} satisfies Prisma.PlanSelect;

/**
 * The single entitlement choke point (M6.1, PRD §"Paywall, Entitlements & Feature Gating").
 *
 * Resolves the acting user's active plan (their live subscription, else Free) and reads the
 * admin-editable `plan_entitlements` matrix — never a hardcoded code default — so the business model
 * can change with no deploy. Exposes two operations:
 *
 * - {@link getEntitlements} powers `GET /me/entitlements` (the transparent usage indicator): every
 *   feature with its boolean access or metered `limit`/`used`/`remaining` for the current window.
 * - {@link enforce} is the guard's reserve-before-work check (directive §4.13): boolean-disabled and
 *   metered-over-cap both throw `402` with an upgrade payload; a metered allow **atomically consumes
 *   one unit** of the current window's counter inside the same transaction (so a concurrent burst can
 *   never exceed the cap, and the increment rolls back if the cap check then fails).
 *
 * `subscriptions`/`usage_counters` are `user_scoped` under Postgres RLS (directive §4.21) so every
 * read/write runs inside {@link RlsService.run}. The lookups still pin `userId: user.id` by natural
 * key because an `admin` actor bypasses RLS — without it an admin would resolve a peer's row.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly rls: RlsService) {}

  /** Every feature's entitlement for the acting user's plan, with live metered quota. */
  async getEntitlements(user: AuthUser): Promise<EntitlementsDto> {
    return this.rls.run(user, async (tx) => {
      const plan = await this.resolvePlan(tx, user);
      const rows = await tx.planEntitlement.findMany({
        where: { planId: plan.id },
        orderBy: { feature: { key: "asc" } },
        select: {
          enabled: true,
          limit: true,
          window: true,
          feature: { select: { key: true, name: true, type: true } },
        },
      });

      const features: EntitlementView[] = [];
      for (const row of rows) {
        if (row.feature.type === "metered") {
          const used =
            row.window === null
              ? 0
              : await this.currentUsage(tx, user, row.feature.key, row.window);
          const remaining = row.limit === null ? null : Math.max(0, row.limit - used);
          features.push({
            key: row.feature.key,
            name: row.feature.name,
            type: "metered",
            enabled: row.enabled,
            limit: row.limit,
            window: row.window,
            used,
            remaining,
          });
        } else {
          features.push({
            key: row.feature.key,
            name: row.feature.name,
            type: "boolean",
            enabled: row.enabled,
          });
        }
      }

      return { plan: { key: plan.key, name: plan.name }, features };
    });
  }

  /**
   * Enforces a gated feature for the acting user. Returns on allow; throws a `402` carrying an
   * {@link EntitlementDeniedPayload} on a closed gate. A metered allow consumes one unit atomically.
   */
  async enforce(user: AuthUser, feature: FeatureKey): Promise<void> {
    await this.rls.run(user, async (tx) => {
      const plan = await this.resolvePlan(tx, user);
      const row = await tx.planEntitlement.findFirst({
        where: { planId: plan.id, feature: { key: feature } },
        select: {
          enabled: true,
          limit: true,
          window: true,
          feature: { select: { type: true } },
        },
      });

      // Fail closed: an unknown feature or a disabled entitlement is a blocked boolean gate.
      if (!row || !row.enabled) {
        throw await this.deny(tx, plan, feature, "feature_disabled", null, null);
      }

      // Boolean feature: enabled ⇒ allowed. Metered with no cap (e.g. Premium fair-use): allowed —
      // degrade-don't-block lives in M6.3, so an unlimited entitlement passes the gate here.
      if (row.feature.type === "boolean" || row.limit === null || row.window === null) {
        return;
      }

      // Metered: reserve one unit, then verify the cap. Both run in this transaction, so throwing on
      // an over-cap reservation rolls the increment back — exactly `limit` uses succeed per window.
      const windowStart = currentWindowStart(row.window, new Date());
      const counter = await tx.usageCounter.upsert({
        where: {
          userId_featureKey_window_windowStart: {
            userId: user.id,
            featureKey: feature,
            window: row.window,
            windowStart,
          },
        },
        create: {
          tenantId: user.tenantId,
          userId: user.id,
          featureKey: feature,
          window: row.window,
          windowStart,
          count: 1,
        },
        update: { count: { increment: 1 } },
        select: { count: true },
      });

      if (counter.count > row.limit) {
        throw await this.deny(tx, plan, feature, "quota_exceeded", row.limit, 0);
      }
    });
  }

  /** Resolves the actor's plan: their live subscription's plan, or Free. */
  private async resolvePlan(
    tx: Prisma.TransactionClient,
    user: AuthUser,
  ): Promise<ResolvedPlan> {
    const subscription = await tx.subscription.findFirst({
      where: { userId: user.id, status: { in: [...LIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      select: { plan: { select: PLAN_SELECT } },
    });
    if (subscription) {
      return subscription.plan;
    }

    const free = await tx.plan.findUnique({
      where: { key: FREE_PLAN_KEY },
      select: PLAN_SELECT,
    });
    if (!free) {
      throw new Error("Free plan is not seeded — run the entitlement catalog seed");
    }
    return free;
  }

  /** The acting user's consumed count for a metered feature in the current window (0 if none yet). */
  private async currentUsage(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    featureKey: string,
    window: UsageWindow,
  ): Promise<number> {
    const counter = await tx.usageCounter.findUnique({
      where: {
        userId_featureKey_window_windowStart: {
          userId: user.id,
          featureKey,
          window,
          windowStart: currentWindowStart(window, new Date()),
        },
      },
      select: { count: true },
    });
    return counter?.count ?? 0;
  }

  /** Builds the `402` exception, including the plans above the current tier that unlock the feature. */
  private async deny(
    tx: Prisma.TransactionClient,
    plan: ResolvedPlan,
    feature: FeatureKey,
    reason: EntitlementDeniedPayload["reason"],
    currentLimit: number | null,
    remainingQuota: number | null,
  ): Promise<HttpException> {
    // Offer only higher tiers that actually grant the feature — and, for a quota wall, that raise the
    // cap (unlimited, or a strictly larger limit) so the upsell is never a no-op.
    const entitlementFilter: Prisma.PlanEntitlementWhereInput = {
      feature: { key: feature },
      enabled: true,
      ...(reason === "quota_exceeded"
        ? { OR: [{ limit: null }, { limit: { gt: currentLimit ?? 0 } }] }
        : {}),
    };
    const higherPlans = await tx.plan.findMany({
      where: {
        active: true,
        sortOrder: { gt: plan.sortOrder },
        entitlements: { some: entitlementFilter },
      },
      orderBy: { sortOrder: "asc" },
      select: { key: true, name: true },
    });

    const payload: EntitlementDeniedPayload = {
      reason,
      feature,
      currentPlan: plan.key,
      upgradeOptions: higherPlans,
      remainingQuota,
    };
    return new HttpException(payload, HttpStatus.PAYMENT_REQUIRED);
  }
}

/**
 * The UTC start of the metered window `now` falls in — the natural key the per-window counter is
 * stored under. Deterministic (UTC-based) so the same wall-clock instant always maps to one window:
 * day → midnight UTC; week → Monday 00:00 UTC (ISO week); month → the 1st 00:00 UTC.
 */
function currentWindowStart(window: UsageWindow, now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  if (window === "day") {
    return new Date(Date.UTC(year, month, day));
  }
  if (window === "month") {
    return new Date(Date.UTC(year, month, 1));
  }
  // week: back up to Monday (getUTCDay: 0=Sun..6=Sat → days since Monday).
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(year, month, day - daysSinceMonday));
}
