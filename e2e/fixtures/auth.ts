import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { authEmulatorRestBase, env, type TestUser } from "./env";

declare global {
  interface Window {
    /** E2E-only programmatic emulator sign-in, exposed by each app's `lib/firebase.ts`. */
    __e2eSignIn?: (email: string, password: string) => Promise<unknown>;
  }
}

/**
 * Mint a Firebase ID token for `user` directly from the Auth **emulator** REST API.
 * Tries sign-up first (idempotent test users), falling back to sign-in if the account
 * already exists. Used for API-level setup/seeding where driving the browser sign-in UI
 * would be wasteful (e.g. obtaining an admin bearer token to publish knowledge).
 *
 * Only valid against the emulator — the emulator accepts any non-empty API key and does
 * not verify passwords cryptographically, so this never touches real credentials.
 */
export async function getEmulatorIdToken(
  request: APIRequestContext,
  user: TestUser,
): Promise<string> {
  const base = authEmulatorRestBase();
  const body = {
    email: user.email,
    password: user.password,
    displayName: user.displayName,
    returnSecureToken: true,
  };

  const signUp = await request.post(`${base}/accounts:signUp?key=${env.firebaseApiKey}`, {
    data: body,
  });
  if (signUp.ok()) {
    return (await signUp.json()).idToken as string;
  }

  // Account already exists → sign in instead.
  const signIn = await request.post(
    `${base}/accounts:signInWithPassword?key=${env.firebaseApiKey}`,
    { data: { ...body, returnSecureToken: true } },
  );
  expect(signIn.ok(), `Auth emulator sign-in failed for ${user.email}`).toBeTruthy();
  return (await signIn.json()).idToken as string;
}

/**
 * Sign `user` in through the app's own Firebase Auth instance, against the emulator.
 *
 * Production sign-in is the Google popup, but `signInWithPopup` loads `apis.google.com` for
 * its OAuth handler, which is unreachable from the sandbox/CI this suite runs in. The apps
 * expose an emulator-gated `window.__e2eSignIn` (see each app's `lib/firebase.ts`) that calls
 * `signInWithEmailAndPassword` on the same Auth instance — no popup, no external network — so
 * `onAuthStateChanged` fires exactly as it would for a real sign-in. The account is created
 * idempotently by the global setup (and again here as a safety net for direct fixture use).
 */
async function emulatorSignIn(page: Page, user: TestUser): Promise<void> {
  await page.waitForFunction(() => typeof window.__e2eSignIn === "function");
  const error = await page.evaluate(
    async ({ email, password }) => {
      try {
        await window.__e2eSignIn!(email, password);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    { email: user.email, password: user.password },
  );
  expect(error, `emulator sign-in failed for ${user.email}: ${error}`).toBeNull();
}

/**
 * Sign `user` into the consumer web app. After this resolves the home page shows the
 * signed-in badge, so callers can navigate to gated pages.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto(env.webBaseUrl);
  await emulatorSignIn(page, user);
  await expect(page.getByText(/signed in as/i)).toBeVisible();
}

/**
 * Sign `user` into the admin/expert portal (`apps/admin`). Resolves once the portal shell
 * is rendered (the "Expert" nav group is always present for any signed-in role). The role
 * itself (expert/admin) is governed server-side by the user's row, not by this sign-in.
 */
export async function signInAdmin(page: Page, user: TestUser): Promise<void> {
  await page.goto(env.adminBaseUrl);
  await emulatorSignIn(page, user);
  await expect(page.getByText("Expert", { exact: true }).first()).toBeVisible();
}
