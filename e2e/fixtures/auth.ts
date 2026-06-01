import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { authEmulatorRestBase, env, type TestUser } from "./env";

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
 * Click the "Sign in with Google" button on the current page and drive the Firebase Auth
 * emulator's popup widget to completion as `user`.
 *
 * The emulator widget flow: an account chooser listing known accounts plus an "Add new
 * account" action that opens an auto-fillable Google sign-in form. We reuse an existing
 * account row when present (faster, deterministic) and create one otherwise.
 */
async function clickGoogleSignInAndDrivePopup(page: Page, user: TestUser): Promise<void> {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  // Reuse an existing emulator account if the chooser already lists this email.
  const existing = popup.getByText(user.email, { exact: false }).first();
  if (await existing.isVisible().catch(() => false)) {
    await existing.click();
    return;
  }

  await popup.getByRole("button", { name: /add new account/i }).click();

  // The emulator pre-fills random data via "Auto-generate user information"; we then
  // overwrite the email so the API mirrors the deterministic test identity.
  const autoGen = popup.getByRole("button", { name: /auto-generate user information/i });
  if (await autoGen.isVisible().catch(() => false)) {
    await autoGen.click();
  }
  const emailField = popup.getByLabel(/email/i).first();
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(user.email);
  }
  const nameField = popup.getByLabel(/display name/i).first();
  if (await nameField.isVisible().catch(() => false)) {
    await nameField.fill(user.displayName);
  }
  await popup.getByRole("button", { name: /sign in with google\.com/i }).click();
}

/**
 * Sign `user` into the consumer web app through the real UI path. After this resolves the
 * home page shows the signed-in badge, so callers can navigate to gated pages.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto(env.webBaseUrl);
  await clickGoogleSignInAndDrivePopup(page, user);
  await expect(page.getByText(/signed in as/i)).toBeVisible();
}

/**
 * Sign `user` into the admin/expert portal (`apps/admin`). Resolves once the portal shell
 * is rendered (the "Expert" nav group is always present for any signed-in role). The role
 * itself (expert/admin) is governed server-side by the user's row, not by this sign-in.
 */
export async function signInAdmin(page: Page, user: TestUser): Promise<void> {
  await page.goto(env.adminBaseUrl);
  await clickGoogleSignInAndDrivePopup(page, user);
  await expect(page.getByText("Expert", { exact: true }).first()).toBeVisible();
}
