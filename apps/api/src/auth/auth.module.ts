import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminSessionService } from "./admin-session.service";
import { AuthService } from "./auth.service";
import { BetaGateService } from "./beta-gate.service";
import { firebaseAuthProvider } from "./firebase-admin.provider";
import { FirebaseAuthGuard } from "./firebase-auth.guard";
import { FirebaseTokenVerifier } from "./firebase-token-verifier";
import { MeController } from "./me.controller";
import { ProfileService } from "./profile.service";
import { RlsService } from "./rls.service";
import { RolesGuard } from "./roles.guard";
import { TokenVerifier } from "./token-verifier";

/**
 * Wires authentication (Firebase token verify) + RBAC as global guards. The
 * guards run in registration order: {@link FirebaseAuthGuard} authenticates and
 * sets `req.authUser`, then {@link RolesGuard} enforces any `@Roles` requirement.
 */
@Module({
  controllers: [MeController],
  providers: [
    firebaseAuthProvider,
    { provide: TokenVerifier, useClass: FirebaseTokenVerifier },
    AuthService,
    BetaGateService,
    AdminSessionService,
    ProfileService,
    RlsService,
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, BetaGateService, RlsService],
})
export class AuthModule {}
