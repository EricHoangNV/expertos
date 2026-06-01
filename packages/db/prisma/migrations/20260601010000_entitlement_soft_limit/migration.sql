-- M6.3 fair-use degrade-don't-block.
--
-- Adds the per-entitlement fair-use soft threshold to the plan×feature matrix. Once a metered
-- feature's count passes `soft_limit` within its window, EntitlementService.enforce serves the
-- answer with a cheaper model (degrade) instead of blocking. NULL = no degradation (the existing
-- behaviour). Nullable + no default, so the column is backwards-compatible with seeded rows.
ALTER TABLE "plan_entitlements" ADD COLUMN "soft_limit" INTEGER;
