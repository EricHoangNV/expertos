import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Concierge review queue (M9.2, M13.6, task M15.3.3). The expert portal's two-pane review queue
 * (`/concierge-reviews`) lists AI answers flagged for human review, scoped to the reviewer's voice.
 * Opening one shows the prompting question + the answer the user saw; the reviewer records a verdict
 * (Good / Bad / Great) and may push a refined edit, which moves the request to `answered` (the M9.3
 * delivery seam fires best-effort behind the commit).
 *
 * The fixture review case (its answer carries the "E2E concierge fixture answer" marker) is seeded in
 * `requested` for the e2e expert by `global-setup.ts` — the fixture conversation is wiped + recreated
 * each run, so the queue starts from a single open item. Signs in as the **expert**: the API scopes
 * the queue to their own linked voice, so there is no admin expert-picker gate to clear.
 */
const ANSWER_MARKER = "E2E concierge fixture answer";
const QUESTION = "How should I price a monthly retainer for a new consulting client?";

test.describe("concierge review queue", () => {
  test("an expert opens a case, records a verdict with an edit, and it leaves the open queue", async ({
    page,
  }) => {
    await signInAdmin(page, users.expert);
    await page.goto(`${env.adminBaseUrl}/concierge-reviews`);
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();

    // Open the seeded case from the queue list, targeted by its unique answer-preview marker so a
    // concurrently-seeded item (e.g. from a chat spec triggering Mode B) can't shadow it.
    const queueItem = page.locator(".queue-item").filter({ hasText: ANSWER_MARKER });
    await expect(queueItem).toBeVisible();
    await queueItem.click();

    // The detail pane resolves the prompting question and the AI answer the user saw.
    const detail = page.locator(".review-detail");
    await expect(detail.getByText(QUESTION)).toBeVisible();
    await expect(detail.locator(".review-answer").filter({ hasText: ANSWER_MARKER })).toBeVisible();

    // Select the "Good" verdict — the card reflects the selection via aria-pressed.
    const good = page.getByRole("button", { name: /Good/ });
    await good.click();
    await expect(good).toHaveAttribute("aria-pressed", "true");

    // Edit the refined answer → the primary action flips from "Record verdict" to "Push refined
    // update". The refined textarea is the first one in the "Refined answer" section (Notes is second).
    const refined = page
      .locator(".review-section")
      .filter({ hasText: "Refined answer" })
      .locator("textarea")
      .first();
    await refined.fill(
      "Estimate the monthly hours, apply your blended rate, then add a 15% retainer premium for priority access.",
    );
    const push = page.getByRole("button", { name: "Push refined update" });
    await expect(push).toBeVisible();
    await push.click();

    // After the verdict commits the queue reloads and the answered case leaves the Open tab…
    await expect(page.locator(".queue-item").filter({ hasText: ANSWER_MARKER })).toHaveCount(0);

    // …and now shows under the Done tab (proof the verdict was recorded and the request resolved).
    await page.getByRole("tab", { name: "Done" }).click();
    await expect(page.locator(".queue-item").filter({ hasText: ANSWER_MARKER })).toBeVisible();
  });

  test("the triage filter switches between Open, Mine, and Done", async ({ page }) => {
    await signInAdmin(page, users.expert);
    await page.goto(`${env.adminBaseUrl}/concierge-reviews`);
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();

    const open = page.getByRole("tab", { name: "Open" });
    const mine = page.getByRole("tab", { name: "Mine" });
    const done = page.getByRole("tab", { name: "Done" });

    // Open is the default selection; clicking each tab moves the aria-selected state.
    await expect(open).toHaveAttribute("aria-selected", "true");
    await mine.click();
    await expect(mine).toHaveAttribute("aria-selected", "true");
    await expect(open).toHaveAttribute("aria-selected", "false");
    await done.click();
    await expect(done).toHaveAttribute("aria-selected", "true");
  });
});
