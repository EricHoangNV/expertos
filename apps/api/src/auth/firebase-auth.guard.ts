import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import type { AuthUser } from "./auth.types";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { TokenVerifier } from "./token-verifier";

interface AuthRequest {
  headers: Record<string, string | undefined>;
  authUser?: AuthUser;
}

/** Extracts a `Bearer <token>` value from an Authorization header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(" ");
  if (scheme !== "Bearer" || !value) {
    return null;
  }
  return value;
}

/**
 * Global authentication guard: verifies the Firebase ID token on every request
 * (unless `@Public()`), resolves the local user, and attaches it as `req.authUser`.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Missing or malformed Authorization header");
    }

    const decoded = await this.tokenVerifier.verify(token);
    req.authUser = await this.authService.resolveUser(decoded);
    return true;
  }
}
