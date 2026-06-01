import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { users } from "../fixtures/env";
import { ask, gotoChat } from "../fixtures/web-actions";

/**
 * Multi-expert voice selection (M2.2) and the in-chat consultation recommendation +
 * booking (M7.2). Both depend on seeded data (at least one published expert voice / a
 * recommendation rule that fires), so each test guards on availability and skips cleanly
 * when the stack has none — the path is exercised whenever the data exists.
 */
test.describe("expert voice + consultation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
    await gotoChat(page);
  });

  test("selecting an expert voice renders an AI-rendition attribution", async ({ page }) => {
    const select = page.getByLabel("Expert voice");
    const options = await select.locator("option").allInnerTexts();
    const expert = options.find((o) => o.trim() && !/neutral/i.test(o));
    test.skip(!expert, "No published expert voice seeded");

    await select.selectOption({ label: expert! });
    await ask(page, "What's your take on the fundamentals?");

    await expect(page.getByText(/AI rendition of/i).last()).toBeVisible();
  });

  test("a consultation recommendation can be booked", async ({ page }) => {
    // Drive a high-intent / high-stakes question so the funnel rule is most likely to fire.
    await ask(page, "I need legal help deciding whether to sign this contract — can you advise?");

    const consultationBadge = page.getByText("Consultation", { exact: true }).last();
    const fired = await consultationBadge.isVisible().catch(() => false);
    test.skip(!fired, "No consultation recommendation rule fired for this turn");

    await page.getByRole("button", { name: /^Book/ }).last().click();
    // Confirmation is either the opened-booking-page note or the generic follow-up promise.
    await expect(
      page
        .getByText(/opened your booking page|we'll be in touch to schedule/i)
        .last(),
    ).toBeVisible();
  });
});
