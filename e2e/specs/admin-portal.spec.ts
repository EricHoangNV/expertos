import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin/Expert portal (M8). Verifies portal access, the role-aware nav, and the
 * expert-review gate surface (M8.1). The full "publish → appears in user retrieval /
 * unpublish → disappears" round-trip is captured as a documented fixme below: it needs a
 * freshly-ingested document to act on, which the live stack seeds out-of-band.
 */
test.describe("admin portal", () => {
  test("an admin sees both Expert and Admin nav groups", async ({ page }) => {
    await signInAdmin(page, users.admin);
    // Expert group is always present; Admin group appears only for a resolved admin role.
    await expect(page.getByText("Expert", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Knowledge" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  });

  test("the knowledge review queue renders and filters by status", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/knowledge`);

    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();

    // Filtering by a published status re-queries without error.
    await page.getByLabel("Status").selectOption({ label: "Published" });
    await expect(page.locator(".badge-red")).toHaveCount(0);
  });

  test("an expert sees the Expert group but not Admin-only surfaces", async ({ page }) => {
    await signInAdmin(page, users.expert);
    await expect(page.getByText("Expert", { exact: true }).first()).toBeVisible();
    // The Admin nav group is a UX gate (the API is the real boundary); an expert role
    // should not be offered the admin-only links in the sidebar.
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  });

  // Full expert-review gate round-trip — requires a freshly-ingested Draft document to
  // act on (seeded via `pnpm --filter @expertos/db db:seed` or the ingest CLI; see README).
  test.fixme(
    "admin publishes a document and it becomes retrievable; unpublish removes it",
    async () => {
      // 1. As admin, open the Draft document detail (`/knowledge/:id`).
      // 2. Submit → Approve → Publish through the state machine.
      // 3. As a member, ask a question the document answers → expect a citation to it.
      // 4. As admin, archive/supersede the version.
      // 5. As the member, re-ask → the citation to that document is gone.
    },
  );
});
