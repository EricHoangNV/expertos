import { SetMetadata } from "@nestjs/common";
import type { FeatureKey } from "@expertos/shared";

export const REQUIRES_ENTITLEMENT_KEY = "requiredEntitlement";

/**
 * Gates a route behind an entitlement-catalog feature (M6.1, PRD §"Paywall, Entitlements & Feature
 * Gating"). Enforced by {@link EntitlementGuard}: a boolean feature must be enabled for the actor's
 * plan, a metered feature must be under its per-window cap (which the guard atomically consumes).
 * Mirrors the `@Roles(...)` RBAC pattern; the feature key is type-checked against the catalog.
 */
export const RequiresEntitlement = (
  feature: FeatureKey,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_ENTITLEMENT_KEY, feature);
