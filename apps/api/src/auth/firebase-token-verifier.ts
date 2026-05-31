import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Auth } from "firebase-admin/auth";
import type { DecodedIdToken } from "./auth.types";
import { FIREBASE_AUTH } from "./firebase-admin.provider";
import { TokenVerifier } from "./token-verifier";

/** {@link TokenVerifier} backed by the Firebase Admin SDK. */
@Injectable()
export class FirebaseTokenVerifier extends TokenVerifier {
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {
    super();
  }

  async verify(idToken: string): Promise<DecodedIdToken> {
    try {
      const decoded = await this.auth.verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email, name: decoded.name };
    } catch {
      // Don't leak the underlying reason (expired vs malformed vs revoked).
      throw new UnauthorizedException("Invalid or expired authentication token");
    }
  }
}
