import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Consumer-facing concierge disclosure (M9.0 / OD#5 ruling). When an answer was reviewed and
 * edited by the human-in-the-loop, the user must see a visible indicator that the response
 * includes AI-reviewed/edited content. This is the *consumer* side of the concierge loop — the
 * reviewer/verdict side is covered by `concierge-review.spec.ts`.
 *
 * The disclosure renders in the /history conversation detail (not live chat) and keys on a
 * delivered refined message (`Message.refinedFromMessageId`). `global-setup.ts` seeds a
 * member-owned "E2E Reviewed Answer Case" conversation whose second assistant message refines the
 * first, so the badge is deterministic.
 */
const REVIEWED_TITLE = "E2E Reviewed Answer Case";

test.describe("concierge consumer disclosure", () => {
  test("a reviewed-and-refined answer shows the disclosure badge in history", async ({ page }) => {
    await signIn(page, users.member);
    await page.goto(`${env.webBaseUrl}/history`);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

    // Open the seeded reviewed conversation by its title (history rows are titled buttons).
    await page.getByRole("button", { name: REVIEWED_TITLE }).first().click();

    // The refined assistant message carries the OD#5 disclosure badge.
    await expect(page.getByText("Reviewed & refined by our team")).toBeVisible();
  });
});
