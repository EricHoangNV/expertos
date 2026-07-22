import { test, expect, type Page } from "@playwright/test";
import { getEmulatorIdToken, signIn } from "../fixtures/auth";
import { env, users, type TestUser } from "../fixtures/env";

/**
 * Private beta gate (consumer app). With the gate on (the seeded default), a signed-in email must
 * have an `allowed_emails` entry (any role) or every API call 403s with BETA_ACCESS_DENIED and the
 * web app swaps the page for the deny card (`BetaGateBoundary`).
 *
 * The denied case uses a dedicated outsider identity that is deliberately NOT in the
 * `fixtures/env.ts` users map, so `global-setup.ts` never whitelists it. The `e2e-` prefix keeps it
 * inside the teardown namespace: `global-teardown.ts` purges any lingering `e2e-*` user/whitelist
 * rows (a denied sign-in itself persists nothing — the gate rolls the user mirror back).
 *
 * The kill-switch flip (Settings → gate off) is deliberately not E2E-tested: the API reads the flag
 * through a 30s TTL cache, which would make an in-test flip timing-fragile. Unit tests cover it.
 */
const OUTSIDER: TestUser = {
  email: "e2e-outsider@expertos.test",
  password: "e2e-password-outsider",
  displayName: "E2E Outsider",
};

/**
 * Sign in through the app's emulator hook without asserting the post-login redirect (the `signIn`
 * fixture waits for `/chat`, which a denied user may never usably reach).
 */
async function emulatorSignInOnly(page: Page, user: TestUser): Promise<void> {
  await page.goto(env.webBaseUrl);
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

test.describe("private beta gate", () => {
  test("a non-whitelisted email is denied with the private-beta screen", async ({
    page,
    request,
  }) => {
    // The outsider is not in global-setup's identity map, so create its emulator account here
    // (idempotent sign-up) — `__e2eSignIn` only signs in existing accounts.
    await getEmulatorIdToken(request, OUTSIDER);
    await emulatorSignInOnly(page, OUTSIDER);

    // The deny card replaces the page once GET /me returns the BETA_ACCESS_DENIED 403.
    await expect(page.getByText("ExpertOS is invite-only right now")).toBeVisible();
    await expect(page.getByText("Private beta")).toBeVisible();

    // Sign out clears the deny state AND routes home itself (the URL usually sits on /chat by the
    // time the card shows), landing the user straight on the signed-out login form — no manual
    // navigation.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
    await expect(page).toHaveURL(`${env.webBaseUrl}/`);
  });

  test("a whitelisted member passes the gate and can use chat", async ({ page }) => {
    await signIn(page, users.member);

    await page.goto(`${env.webBaseUrl}/chat`);
    // The composer is the stable landmark of a usable chat shell — the gate let the member in.
    await expect(page.getByPlaceholder(/Ask .*about your business/)).toBeVisible();
    await expect(page.getByText("ExpertOS is invite-only right now")).not.toBeVisible();
  });
});
