import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Plan & usage transparency (M6.3). The free → quota-wall → upgrade → checkout path from
 * the matrix is partially represented: the consumer web exposes the plan + transparent
 * usage meter, but a self-serve checkout CTA is not yet built into `apps/web` (Stripe
 * checkout is wired in the API/admin), so the checkout leg is a documented fixme.
 */
test.describe("plan & usage", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
  });

  test("the account page shows the current plan and a usage meter", async ({ page }) => {
    await page.goto(`${env.webBaseUrl}/account`);
    await expect(page.getByRole("heading", { name: "Plan & usage" })).toBeVisible();

    await expect(page.getByText(/Current plan:/i)).toBeVisible();
    // A metered free plan renders the transparent usage indicator (M6.3 `.bar` meter).
    await expect(page.getByText("Usage this period").or(page.getByText("Features"))).toBeVisible();
  });

  // Self-serve checkout CTA is not yet present in apps/web (Stripe checkout lives in the
  // API + admin). When the upgrade CTA lands, drive: quota wall → Upgrade → Stripe test
  // checkout → entitlement reflected on this page.
  test.fixme("free user hits the quota wall and upgrades via checkout", async () => {
    // 1. Exhaust the free metered allowance (loop ask until the quota meter is full).
    // 2. Expect the over-limit / fair-use messaging.
    // 3. Click Upgrade → complete Stripe test checkout.
    // 4. Reload /account → plan reflects the new entitlement.
  });
});
