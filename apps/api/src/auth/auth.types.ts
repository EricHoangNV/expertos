import type { Role } from "@expertos/shared";
import type { Language } from "@expertos/db";

/**
 * The subset of a verified Firebase ID token the app relies on. Produced by a
 * {@link TokenVerifier} so the rest of the app never imports the Firebase SDK.
 */
export interface DecodedIdToken {
  /** Firebase UID — stable, globally unique principal id. */
  uid: string;
  email?: string;
  name?: string;
}

/**
 * The authenticated principal attached to each request (`req.authUser`) after the
 * {@link FirebaseAuthGuard} verifies the token and resolves the local user row.
 */
export interface AuthUser {
  id: string;
  tenantId: string;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  role: Role;
  locale: Language;
}
