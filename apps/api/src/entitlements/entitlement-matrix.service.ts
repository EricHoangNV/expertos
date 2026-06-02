import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  EntitlementCellDto,
  EntitlementMatrixDto,
  EntitlementUpdateInput,
} from "@expertos/shared";
import type { UsageWindow } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

/**
 * The admin plan-entitlement matrix editor (M8.3, PRD §"Admin" → "Plan-entitlement matrix editor").
 *
 * The single **write** choke point over the `plan_entitlements` config table — the one mutation
 * surface of M8.3 (revenue/inspector are read-only). What is free vs paid, and the metered quotas
 * (M6.5 seed defaults), become admin-tunable with **no deploy**: a saved cell takes effect on the
 * next {@link EntitlementService.enforce}/{@link EntitlementService.getEntitlements} read (they read
 * the same table).
 *
 * `plans`/`features`/`plan_entitlements` are global **RLS-exempt config** (no per-tenant policy), so
 * a cell change is platform-wide. Work still runs inside {@link RlsService.run} for the transaction
 * (an upsert + its lookups are atomic) and the admin GUC, consistent with the other admin services;
 * the `@Roles("admin")` route guard is what gates the caller.
 *
 * Identity (`planId`/`featureId`) is never taken from the body — only the path — so a save can't
 * reassign a cell to a different plan/feature (directive §4.7). Type-coherence is derived
 * server-side (directive §4.20): a boolean feature's metered fields are forced to `null`, and an
 * incoherent metered config (a `softLimit` that a hard `limit` makes unreachable, or a quota with no
 * window to meter against) is rejected.
 */
@Injectable()
export class EntitlementMatrixService {
  constructor(private readonly rls: RlsService) {}

  /** The full plan × feature matrix the editor renders (every plan, every feature, populated cells). */
  async getMatrix(user: AuthUser): Promise<EntitlementMatrixDto> {
    return this.rls.run(user, async (tx) => {
      const plans = await tx.plan.findMany({
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          key: true,
          name: true,
          sortOrder: true,
          active: true,
          prices: {
            select: { interval: true, amountCents: true, currency: true },
            orderBy: { interval: "asc" },
          },
        },
      });
      const features = await tx.feature.findMany({
        orderBy: { key: "asc" },
        select: { id: true, key: true, name: true, type: true },
      });
      const rows = await tx.planEntitlement.findMany({
        select: {
          planId: true,
          featureId: true,
          enabled: true,
          limit: true,
          softLimit: true,
          window: true,
        },
      });

      return {
        plans: plans.map((plan) => ({
          id: plan.id,
          key: plan.key,
          name: plan.name,
          sortOrder: plan.sortOrder,
          active: plan.active,
          prices: plan.prices.map((price) => ({
            interval: price.interval,
            amountCents: price.amountCents,
            currency: price.currency,
          })),
        })),
        features,
        cells: rows.map((row) => ({
          planId: row.planId,
          featureId: row.featureId,
          enabled: row.enabled,
          limit: row.limit,
          softLimit: row.softLimit,
          window: row.window,
        })),
      };
    });
  }

  /**
   * Upserts one (plan, feature) entitlement cell and returns its persisted value. Validates that the
   * plan and feature exist (→404), derives type-coherent metered fields from the feature type, and
   * rejects an incoherent metered config (→400) before writing.
   */
  async updateCell(
    user: AuthUser,
    planId: string,
    featureId: string,
    input: EntitlementUpdateInput,
  ): Promise<EntitlementCellDto> {
    return this.rls.run(user, async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!plan) {
        throw new NotFoundException("Plan not found");
      }
      const feature = await tx.feature.findUnique({
        where: { id: featureId },
        select: { id: true, type: true },
      });
      if (!feature) {
        throw new NotFoundException("Feature not found");
      }

      const values = coherentValues(feature.type, input);

      const row = await tx.planEntitlement.upsert({
        where: { planId_featureId: { planId, featureId } },
        update: {
          enabled: values.enabled,
          limit: values.limit,
          softLimit: values.softLimit,
          window: values.window,
        },
        create: {
          planId,
          featureId,
          enabled: values.enabled,
          limit: values.limit,
          softLimit: values.softLimit,
          window: values.window,
        },
        select: {
          planId: true,
          featureId: true,
          enabled: true,
          limit: true,
          softLimit: true,
          window: true,
        },
      });

      return {
        planId: row.planId,
        featureId: row.featureId,
        enabled: row.enabled,
        limit: row.limit,
        softLimit: row.softLimit,
        window: row.window,
      };
    });
  }
}

/** The values actually stored for a cell, after type-coercion + cross-field validation. */
interface CoherentCell {
  enabled: boolean;
  limit: number | null;
  softLimit: number | null;
  window: UsageWindow | null;
}

/**
 * Reconciles the submitted cell with the feature type: a **boolean** feature has no quota, so its
 * metered fields are forced to `null` (the editor hides them, but never trust the client — §4.20). A
 * **metered** feature keeps the submitted quota, but it must be coherent:
 *  - a `softLimit` that is `>=` a non-null hard `limit` would never fire before the cap → rejected;
 *  - a `limit`/`softLimit` with no `window` has nothing to meter against → rejected.
 */
function coherentValues(type: "boolean" | "metered", input: EntitlementUpdateInput): CoherentCell {
  if (type === "boolean") {
    return { enabled: input.enabled, limit: null, softLimit: null, window: null };
  }

  const { limit, softLimit, window } = input;
  if (limit !== null && softLimit !== null && softLimit >= limit) {
    throw new BadRequestException("Soft limit must be below the hard limit to take effect");
  }
  if ((limit !== null || softLimit !== null) && window === null) {
    throw new BadRequestException("A metered quota requires a window (day, week, or month)");
  }
  return { enabled: input.enabled, limit, softLimit, window };
}
