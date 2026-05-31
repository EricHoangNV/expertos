import type { Provider } from "@nestjs/common";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";

/** DI token for the Firebase Admin {@link Auth} instance. */
export const FIREBASE_AUTH = "FIREBASE_AUTH";

/**
 * Builds (or reuses) the Firebase Admin app from service-account credentials in
 * the environment. Credentials come from Secret Manager in production — never
 * committed. `FIREBASE_PRIVATE_KEY` is stored with escaped newlines (`\n`), which
 * we unescape here.
 */
export function createFirebaseApp(env: NodeJS.ProcessEnv = process.env): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase credentials missing: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY",
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

/** Provides the Firebase Admin {@link Auth} instance, lazily initialized. */
export const firebaseAuthProvider: Provider = {
  provide: FIREBASE_AUTH,
  useFactory: (): Auth => getAuth(createFirebaseApp()),
};
