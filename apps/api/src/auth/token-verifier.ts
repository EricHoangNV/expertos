import type { DecodedIdToken } from "./auth.types";

/**
 * Abstraction over identity-provider token verification. Used as a NestJS DI
 * token so the Firebase implementation ({@link FirebaseTokenVerifier}) is the
 * only place that touches the Firebase Admin SDK — and tests inject a fake.
 */
export abstract class TokenVerifier {
  /** Verify a bearer ID token; reject (throw) if invalid/expired. */
  abstract verify(idToken: string): Promise<DecodedIdToken>;
}
