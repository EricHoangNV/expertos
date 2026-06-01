/**
 * Centralized E2E environment configuration. Every URL, credential, and toggle the
 * suite needs is read here (with dev-friendly defaults) so a spec never reaches into
 * `process.env` directly. Override any of these when pointing the suite at a different
 * stack (CI, staging) via the matching environment variable.
 *
 * The defaults assume the documented local stack from `e2e/README.md`:
 *   - API on :3001, web on :3000, admin on :3002
 *   - the Firebase Auth **emulator** on :9099 with project `expertos-e2e`
 */

/** Read a string env var, falling back to `fallback` when unset/empty. */
function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  /** Consumer web app base URL (Next.js, `apps/web`). */
  webBaseUrl: str("E2E_WEB_URL", "http://localhost:3000"),
  /** Admin/expert portal base URL (Next.js, `apps/admin`). */
  adminBaseUrl: str("E2E_ADMIN_URL", "http://localhost:3002"),
  /** API base URL (NestJS, `apps/api`). */
  apiBaseUrl: str("E2E_API_URL", "http://localhost:3001"),

  /** Firebase project id used by both the emulator and the web/admin client config. */
  firebaseProjectId: str("E2E_FIREBASE_PROJECT_ID", "expertos-e2e"),
  /** Web API key — any non-empty string is accepted by the Auth emulator. */
  firebaseApiKey: str("E2E_FIREBASE_API_KEY", "expertos-e2e-key"),
  /** `host:port` of the running Firebase Auth emulator. */
  authEmulatorHost: str("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"),
} as const;

/** A test identity. Passwords are only meaningful against the Auth emulator. */
export interface TestUser {
  email: string;
  password: string;
  displayName: string;
}

/**
 * Deterministic test identities. The suite signs in as these against the Auth
 * emulator; the API mirrors a local user row on first sign-in (see `AuthService`).
 * Roles (expert/admin) are assigned out-of-band by the seed/setup documented in the
 * README — the email addresses below are the join key.
 */
export const users = {
  /** A standard consumer (default `user` role). */
  member: {
    email: "e2e-member@expertos.test",
    password: "e2e-password-1",
    displayName: "E2E Member",
  },
  /** A second consumer, used for cross-user isolation checks. */
  other: {
    email: "e2e-other@expertos.test",
    password: "e2e-password-2",
    displayName: "E2E Other",
  },
  /** An expert-role user for the expert portal flows. */
  expert: {
    email: "e2e-expert@expertos.test",
    password: "e2e-password-3",
    displayName: "E2E Expert",
  },
  /** An admin-role user for the admin portal flows. */
  admin: {
    email: "e2e-admin@expertos.test",
    password: "e2e-password-4",
    displayName: "E2E Admin",
  },
} as const satisfies Record<string, TestUser>;

/** Base URL of the Auth emulator's REST API (identitytoolkit shim). */
export function authEmulatorRestBase(): string {
  return `http://${env.authEmulatorHost}/identitytoolkit.googleapis.com/v1`;
}
