import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "./auth.types";

/** Injects the authenticated {@link AuthUser} (set by {@link FirebaseAuthGuard}). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ authUser: AuthUser }>();
    return req.authUser;
  },
);
