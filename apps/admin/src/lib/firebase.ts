import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { type Auth, getAuth, GoogleAuthProvider } from "firebase/auth";

/**
 * Firebase **client** config — only `NEXT_PUBLIC_*` values, which are safe to ship
 * to the browser (they identify the project; security comes from Auth rules + the
 * API verifying ID tokens server-side). The Admin SDK + private key live in the API.
 *
 * Mirrors `apps/web/src/lib/firebase.ts` — the admin portal authenticates the same way;
 * the `expert`/`admin` role gate that protects the knowledge routes is enforced server-side.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Whether the browser build was given client credentials (false during CI build / unconfigured dev). */
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey);

let cachedAuth: Auth | undefined;

/**
 * Lazily initializes Firebase Auth. Must only be called client-side (in effects /
 * event handlers) — calling `getAuth` with empty config throws `auth/invalid-api-key`,
 * so deferring init keeps server-side prerender (which never runs effects) building
 * without credentials.
 */
export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    cachedAuth = getAuth(app);
  }
  return cachedAuth;
}

export const googleProvider = new GoogleAuthProvider();
