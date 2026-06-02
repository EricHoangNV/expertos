import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin/Expert portal (M8, M13). Verifies portal access through the M14 access-control gate,
 * the role-aware M13.1 nav (OPERATE / MONETIZE / EXPERT PORTAL groups + role badge), and the
 * M13.3 knowledge-approval kanban (the expert-review gate surface, M8.1). The full
 * "publish → appears in user retrieval / unpublish → disappears" round-trip is captured as a
 * documented fixme below: it needs a freshly-ingested document to act on, which the live stack
 * seeds out-of-band.
 *
 * Nav labels render the EN dictionary values uppercased by CSS; Playwright matches `textContent`
 * (not the CSS transform), so group/badge text is matched case-insensitively.
 */
test.describe("admin portal", () => {
  test("an admin sees the full role-aware nav (OPERATE / MONETIZE / EXPERT PORTAL)", async ({
    page,
  }) => {
    await signInAdmin(page, users.admin);
    // EXPERT PORTAL is present for every authorized role; MONETIZE is an admin-only group, so
    // its presence (plus the "Admin view" role badge) confirms the admin role resolved.
    await expect(page.getByText(/^expert portal$/i).first()).toBeVisible();
    await expect(page.getByText(/^monetize$/i).first()).toBeVisible();
    await expect(page.getByText(/^admin view$/i).first()).toBeVisible();
    // Admin-only sidebar links, scoped to the dark `.side` rail so descriptive dashboard cards
    // don't collide. The Knowledge item carries an attention count badge (M13.1.2) whose number
    // joins the link's accessible name (e.g. "Knowledge 1") when any document is in Expert Review,
    // so match the label with an optional trailing count rather than exactly.
    const side = page.locator(".side");
    await expect(side.getByRole("link", { name: /^Knowledge( \d+)?$/ })).toBeVisible();
    await expect(
      side.getByRole("link", { name: "Users & Subscriptions", exact: true }),
    ).toBeVisible();
  });

  test("the knowledge-approval kanban renders and filters by status", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/knowledge`);

    await expect(page.getByRole("heading", { name: "Knowledge approval" })).toBeVisible();
    // The board (M13.3.3) is four status columns (Draft / AI Processing / Expert Review /
    // Published), always present even when empty against a freshly-seeded stack.
    await expect(page.locator(".kanban-col")).toHaveCount(4);

    // The numbered step indicator (M13.3.2) narrows the board to a single stage without error.
    // Its buttons carry the stable English stage names.
    await page.getByRole("button", { name: "Published", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expert Review", exact: true })).toBeVisible();
  });

  test("an expert sees the Expert group but not Admin-only surfaces", async ({ page }) => {
    await signInAdmin(page, users.expert);
    await expect(page.getByText(/^expert portal$/i).first()).toBeVisible();
    // The MONETIZE group and its admin-only links are a UX gate over the real `@Roles` API
    // boundary; an expert role should not be offered them in the sidebar.
    await expect(page.getByText(/^monetize$/i)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Users & Subscriptions", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/^expert view$/i).first()).toBeVisible();
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
