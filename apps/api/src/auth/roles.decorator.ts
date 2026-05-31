import { SetMetadata } from "@nestjs/common";
import type { Role } from "@expertos/shared";

export const ROLES_KEY = "requiredRole";

/**
 * Requires the actor to hold at least `role` (privilege is hierarchical:
 * admin ≥ expert ≥ user — see `satisfiesRole`). Enforced by {@link RolesGuard}.
 */
export const Roles = (role: Role): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, role);
