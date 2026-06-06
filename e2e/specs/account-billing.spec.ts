import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Plan & usage transparency (M6.3) + self-serve upgrade (M6.2). The consumer web exposes the
 * current plan, the transparent usage meter, and — now — a self-serve checkout CTA (`GET /me/plans`
 * → `POST /billing/checkout`). The only leg that stays a documented fixme is completing the
 * Stripe-hosted payment page itself (an external surface the suite shouldn't automate).
 */
test.describe("plan & usage", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
  });

  test("the account page shows the current plan and a usage meter", async ({ page }) => {
    await page.goto(`${env.webBaseUrl}/account`);
    // The account page leads with the identity header (M19.1.2) — avatar + "Account" + email.
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    await expect(page.getByText(/Current plan:/i)).toBeVisible();
    // A metered plan renders the transparent usage indicator (M6.3 `.bar` meter); a plan with
    // boolean features renders the "Features" list. `.first()` keeps the combined locator
    // single-element when both sections are present (otherwise strict mode trips).
    await expect(
      page.getByText("Usage this period").or(page.getByText("Features")).first(),
    ).toBeVisible();
  });

  test("a free user is offered a self-serve upgrade CTA", async ({ page }) => {
    await page.goto(`${env.webBaseUrl}/account`);
    await expect(page.getByText(/Current plan:/i)).toBeVisible();

    // `GET /me/plans` returns the priced higher tiers; each renders an "Upgrade to …" button
    // that starts a hosted Stripe checkout (M6.2). Seed must publish at least one paid plan price.
    await expect(page.getByRole("button", { name: /Upgrade to /i }).first()).toBeVisible();
  });

  // The button click hands off to Stripe's hosted checkout page — an external surface this suite
  // shouldn't drive, so this stays a documented fixme (M15.3.5): completing payment lives on
  // Stripe's domain, not the app. When a Stripe test harness lands: click Upgrade → complete test
  // checkout → webhook syncs the subscription → reload /account → plan reflects the new entitlement.
  test.fixme("completing checkout reflects the new entitlement", async () => {
    // 1. Click "Upgrade to …" → land on the Stripe-hosted checkout.
    // 2. Complete the Stripe test checkout (test card).
    // 3. Webhook syncs the subscription into `subscriptions`.
    // 4. Reload /account → "Current plan" reflects the new entitlement.
  });
});
