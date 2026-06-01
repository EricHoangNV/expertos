import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FeatureKey } from "@expertos/shared";
import type { AuthUser } from "../auth/auth.types";
import {
  type EntitlementDecision,
  EntitlementService,
} from "./entitlement.service";
import { ENTITLEMENT_DECISION_KEY } from "./entitlement-decision.decorator";
import { REQUIRES_ENTITLEMENT_KEY } from "./requires-entitlement.decorator";

/** The request shape the guard reads/writes — the auth user in, the gate decision out. */
interface GuardedRequest {
  authUser?: AuthUser;
  [ENTITLEMENT_DECISION_KEY]?: EntitlementDecision;
}

/**
 * Enforces the `@RequiresEntitlement(...)` requirement (M6.1) via {@link EntitlementService.enforce}.
 * Registered as a global guard that runs after {@link FirebaseAuthGuard}/{@link RolesGuard} (which
 * set `req.authUser`); a route with no `@RequiresEntitlement` is allowed for any authenticated user.
 * A blocked gate surfaces as a `402` with an upgrade payload from the service; a passing gate stashes
 * its {@link EntitlementDecision} on the request so a handler can read the fair-use tier (M6.3) via
 * `@EntitlementDecisionParam()`.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRES_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) {
      return true;
    }

    const req = context.switchToHttp().getRequest<GuardedRequest>();
    const user = req.authUser;
    if (!user) {
      throw new UnauthorizedException();
    }

    req[ENTITLEMENT_DECISION_KEY] = await this.entitlements.enforce(user, feature);
    return true;
  }
}
