import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Role, satisfiesRole } from "@expertos/shared";
import type { AuthUser } from "./auth.types";
import { ROLES_KEY } from "./roles.decorator";

/**
 * RBAC guard: enforces the `@Roles(...)` requirement using the hierarchical
 * `satisfiesRole` check. Runs after {@link FirebaseAuthGuard} (which sets
 * `req.authUser`). Routes with no `@Roles` requirement are allowed for any
 * authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<{ authUser?: AuthUser }>();
    const user = req.authUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    if (!satisfiesRole(user.role, required)) {
      throw new ForbiddenException(`Requires ${required} role`);
    }
    return true;
  }
}
