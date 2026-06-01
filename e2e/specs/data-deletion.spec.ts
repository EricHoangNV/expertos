import { test, expect } from "@playwright/test";
import { getEmulatorIdToken, signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin user management + data deletion (M8.4, NT.3). Ensures the target user exists
 * (first authenticated call mirrors the row — see `AuthService`), then drives the admin
 * data-deletion panel. The non-destructive "record deletion request" is asserted live;
 * the irreversible cascade is a documented fixme so the suite never wipes shared seed
 * state non-deterministically.
 */
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

    // Open the target user's detail from the roster.
    await page.getByText(users.other.email, { exact: false }).first().click();

    await expect(page.getByText("Data deletion")).toBeVisible();
    await page.getByRole("button", { name: "Record deletion request" }).click();
    await expect(page.getByText("Deletion request recorded.")).toBeVisible();
  });

  // Irreversible GDPR cascade (`DELETE /admin/users/:id`). Run against a throwaway user so
  // it can verify the row + owned data (conversations, uploads, feedback) are gone.
  test.fixme("an admin permanently deletes a user and all owned data", async () => {
    // 1. Open the user detail → "Delete data…" → confirm "Permanently delete <email>?".
    // 2. Expect to be returned to /users with the row gone.
    // 3. As that user, sign in again → a fresh empty account (no prior conversations).
  });
});
