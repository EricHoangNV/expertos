import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin-portal access-control whitelist (M14, task M15.3.2). An admin manages the `allowed_emails`
 * whitelist from `/access-control`: add an email, change its role, remove it. A non-whitelisted
 * email is blocked at sign-in (`POST /me/admin-session` → 403) and sees the Access Denied screen.
 *
 * Uses a throwaway email so it never collides with the deterministic e2e-* identities the rest of
 * the suite signs in as, and cleans up after itself by removing the row it adds.
 */
const TEMP_EMAIL = "e2e-whitelist-temp@expertos.test";

test.describe("admin access control", () => {
  test("an admin can add, re-role, and remove a whitelist entry", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/access-control`);
    await expect(page.getByRole("heading", { name: "Access control" })).toBeVisible();

    // Add the email as an expert → it appears in the table with an "Added …" notice. The form
    // fields are matched by placeholder / the lone <select> (the Field label isn't associated to
    // its control via htmlFor, so getByLabel doesn't resolve them).
    await page.getByPlaceholder("person@example.com").fill(TEMP_EMAIL);
    await page.locator("select").first().selectOption("expert");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(`Added ${TEMP_EMAIL}.`)).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: TEMP_EMAIL });
    await expect(row).toBeVisible();

    // Re-role expert → admin via the row's role toggle.
    await row.getByRole("button", { name: "Make admin" }).click();
    await expect(page.getByText(`${TEMP_EMAIL} is now admin.`)).toBeVisible();

    // Remove the row (a window.confirm guards it — accept the dialog), then it is gone.
    page.on("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(`Removed ${TEMP_EMAIL}.`)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: TEMP_EMAIL })).toHaveCount(0);
  });

  test("a non-whitelisted user is shown the Access Denied screen", async ({ page }) => {
    // users.other is never added to the whitelist, so `POST /me/admin-session` 403s and the portal
    // renders Access Denied instead of the shell. Sign in directly (the shared signInAdmin fixture
    // waits for the shell, which a denied user never reaches).
    await page.goto(env.adminBaseUrl);
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
      { email: users.other.email, password: users.other.password },
    );
    expect(error, `emulator sign-in failed for ${users.other.email}`).toBeNull();

    await expect(page.getByText(/access denied/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("removing a whitelist entry revokes that user's portal access", async ({ browser }) => {
    // Guards the admin-whitelist-revocation fix: the whitelist is the source of truth for portal
    // roles, so removing an entry must immediately deny that user (no stale elevated access). Uses
    // the real `users.other` identity so the grant→revoke is observed through actual portal sign-in.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    // Accept the window.confirm guarding "Remove" (registered once; reused by the cleanup below).
    adminPage.on("dialog", (dialog) => void dialog.accept());
    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();

    const signInOther = async (): Promise<void> => {
      await otherPage.goto(env.adminBaseUrl);
      await otherPage.waitForFunction(() => typeof window.__e2eSignIn === "function");
      await otherPage.evaluate(
        async ({ email, password }) => {
          await window.__e2eSignIn!(email, password);
        },
        { email: users.other.email, password: users.other.password },
      );
    };

    try {
      // 1. Admin grants `other` expert access via the whitelist.
      await signInAdmin(adminPage, users.admin);
      await adminPage.goto(`${env.adminBaseUrl}/access-control`);
      await adminPage.getByPlaceholder("person@example.com").fill(users.other.email);
      await adminPage.locator("select").first().selectOption("expert");
      await adminPage.getByRole("button", { name: "Add", exact: true }).click();
      await expect(adminPage.getByText(`Added ${users.other.email}.`)).toBeVisible();

      // 2. `other` can now reach the portal shell (the "Expert portal" nav group renders).
      await signInOther();
      await expect(otherPage.getByText(/^expert portal$/i).first()).toBeVisible();

      // 3. Admin removes the entry → access is revoked.
      const row = adminPage.getByRole("row").filter({ hasText: users.other.email });
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(adminPage.getByText(`Removed ${users.other.email}.`)).toBeVisible();

      // 4. A fresh portal entry by `other` now hits Access Denied — the gate re-checks the
      //    whitelist on sign-in, so the revoked user no longer reaches the shell.
      await signInOther();
      await expect(otherPage.getByText(/access denied/i)).toBeVisible();
    } finally {
      // Safety net: never leave `other` whitelisted — it would break the deny test above on reorder.
      const leftover = adminPage.getByRole("row").filter({ hasText: users.other.email });
      if ((await leftover.count().catch(() => 0)) > 0) {
        await leftover.getByRole("button", { name: "Remove" }).click().catch(() => {});
      }
      await adminCtx.close();
      await otherCtx.close();
    }
  });
});
