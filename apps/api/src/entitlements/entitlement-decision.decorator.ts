import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { EntitlementDecision } from "./entitlement.service";

/** The request key the {@link EntitlementGuard} stashes its gate decision under. */
export const ENTITLEMENT_DECISION_KEY = "entitlementDecision";

/**
 * Injects the {@link EntitlementDecision} the {@link EntitlementGuard} computed for the route's
 * `@RequiresEntitlement(...)` feature (M6.3) — so a handler can serve the fair-use cheaper model when
 * the actor is `degraded`. Defaults to `allow` for an ungated route (the guard set nothing), so a
 * handler that opts into the decision never sees `undefined`.
 */
export const EntitlementDecisionParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EntitlementDecision => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ [ENTITLEMENT_DECISION_KEY]?: EntitlementDecision }>();
    return req[ENTITLEMENT_DECISION_KEY] ?? { outcome: "allow" };
  },
);
