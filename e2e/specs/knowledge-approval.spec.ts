import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Knowledge approval round-trip (M8.1, M13.3, task M15.3.4). The kanban board (`/knowledge`) is the
 * expert-review gate (PRD §"Admin & Expert portals"): a document parked in Expert Review is
 * approved → published, which flips its version (and chunks) to published and moves the card from
 * the Expert Review column to Published.
 *
 * The fixture document ("E2E Expert-Review Note") is seeded in `expert_review` by `global-setup.ts`
 * and reset to that state every run (a prior approve published it), so the round-trip is repeatable.
 * Signs in as admin — admin satisfies the `@Roles("expert")` board API via the role hierarchy,
 * matching the existing admin-portal kanban test. Column/step labels carry stable English text.
 */
const DOC_TITLE = "E2E Expert-Review Note";

test.describe("knowledge approval (kanban)", () => {
  test("an admin approves an Expert-Review document and it moves to Published", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/knowledge`);
    await expect(page.getByRole("heading", { name: "Knowledge approval" })).toBeVisible();

    // Three status columns (Draft / Expert Review / Published), Published last.
    const columns = page.locator(".kanban-col");
    await expect(columns).toHaveCount(3);

    // The seeded card sits in Expert Review with an "Approve & publish" action. Multiple
    // Expert-Review cards may exist, so scope the action to the card carrying our title.
    const reviewCard = page.locator(".kanban-card").filter({ hasText: DOC_TITLE });
    await expect(reviewCard).toBeVisible();
    await reviewCard.getByRole("button", { name: "Approve & publish" }).click();

    // After the approve commits the board reloads: the document is now Published, so its card
    // appears in the last column and no longer offers the approve action.
    const publishedCard = columns.last().locator(".kanban-card").filter({ hasText: DOC_TITLE });
    await expect(publishedCard).toBeVisible();
    await expect(
      page.locator(".kanban-card").filter({ hasText: DOC_TITLE }).getByRole("button", {
        name: "Approve & publish",
      }),
    ).toHaveCount(0);
  });

  test("the status pipeline narrows the board to a single stage", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/knowledge`);
    await expect(page.locator(".kanban-col")).toHaveCount(3);

    // The numbered step indicator filters the board to one stage without error; the other stage
    // buttons stay reachable so the view can be re-widened.
    await page.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(page.getByRole("button", { name: "Published", exact: true })).toBeVisible();
  });
});
