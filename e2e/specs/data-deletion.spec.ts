import { test, expect } from "@playwright/test";
import { getEmulatorIdToken, signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin user management + data deletion (M8.4, NT.3). Ensures the target user exists
 * (first authenticated call mirrors the row — see `AuthService`), then drives the admin
 * data-deletion panel. The non-destructive "record deletion request" is asserted against a
 * shared identity; the irreversible cascade (`DELETE /admin/users/:id`, M15.3.5) is asserted
 * against a dedicated throwaway user so the suite never wipes shared seed state.
 */

/** The throwaway user `global-setup.ts` seeds for the cascade round-trip (DB-only). */
const DELETABLE_EMAIL = "e2e-deletable@expertos.test";

test.describe("admin data deletion", () => {
  test.beforeEach(async ({ request }) => {
    // Touch an authenticated endpoint as the target user so the API mirrors their row.
    const token = await getEmulatorIdToken(request, users.other);
    const res = await request.get(`${env.apiBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok(), "expected /me to mirror the target user row").toBeTruthy();
  });

  test("an admin can record a deletion request for a user", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/users`);

    // Open the target user's detail from the roster — the email shows in the row, but the
    // navigation affordance is the row's "Manage" link.
    const row = page.getByRole("row").filter({ hasText: users.other.email });
    await row.getByRole("link", { name: "Manage" }).click();

    await expect(page.getByText("Data deletion")).toBeVisible();
    await page.getByRole("button", { name: "Record deletion request" }).click();
    await expect(page.getByText("Deletion request recorded.")).toBeVisible();
  });

  // Irreversible GDPR cascade (`DELETE /admin/users/:id`). Driven against a dedicated throwaway
  // user — `e2e-deletable@…`, seeded with an owned conversation by `global-setup.ts` and
  // re-created every run — so the cascade round-trip is repeatable and never wipes a shared test
  // identity. A successful delete is itself proof the cascade ran: were the owned rows not
  // cascaded, the DELETE would fail with an FK violation (surfacing the "Failed to delete user."
  // badge instead of the redirect), so a clean redirect + the row vanishing from the roster
  // confirms the user *and* their owned data are gone.
  test("an admin permanently deletes a user and all owned data", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/users`);

    // Find the throwaway user via the roster search so the row is reachable regardless of how
    // many users the stack holds (the list is the newest 50).
    await page.getByPlaceholder("email or name").fill(DELETABLE_EMAIL);
    await page.getByRole("button", { name: "Apply" }).click();
    const row = page.getByRole("row").filter({ hasText: DELETABLE_EMAIL });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Manage" }).click();

    // The detail confirms the user has owned data (the seeded conversation), so the deletion is a
    // real cascade — not a vacuous delete of a dataless row.
    const conversationStat = page.locator(".stat").filter({ hasText: "Conversations" });
    await expect(conversationStat.locator(".v")).not.toHaveText("0");

    // Two-step confirm guard, then the irreversible delete.
    await page.getByRole("button", { name: "Delete data…" }).click();
    await expect(
      page.getByText(`Permanently delete ${DELETABLE_EMAIL}?`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm delete" }).click();

    // On success the panel returns to the roster (router.push("/users")). Re-search to prove the
    // row — and therefore the user + their owned data — is gone.
    await expect(page).toHaveURL(/\/users\/?$/);
    await page.getByPlaceholder("email or name").fill(DELETABLE_EMAIL);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("row").filter({ hasText: DELETABLE_EMAIL })).toHaveCount(0);
    await expect(page.getByText("No users match.")).toBeVisible();
  });
});
