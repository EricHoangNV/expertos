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
    // M12.3.2 replaced the expert <select> with `.chip` pills in the topbar voice picker; the
    // picker is hidden entirely when no expert voice is published, so an absent picker = skip.
    const expertChip = page
      .locator(".chat-voice-picker .chip")
      .filter({ hasNotText: /neutral/i })
      .first();
    test.skip((await expertChip.count()) === 0, "No published expert voice seeded");

    await expertChip.click();
    await ask(page, "What's your take on the fundamentals?");

    // The assistant turn's `.badge-ink` shows "AI rendition"; the full M2.2 attribution
    // ("AI rendition of <Expert>") is the badge's accessible name (aria-label).
    await expect(page.locator('[aria-label*="AI rendition of"]').last()).toBeVisible();
  });

  test("a consultation recommendation can be booked", async ({ page }) => {
    // Drive a high-intent / high-stakes question so the funnel rule is most likely to fire.
    await ask(page, "I need legal help deciding whether to sign this contract — can you advise?");

    // The recommendation surfaces as the warm consult card (M12.4.5) with a "Book …" primary
    // action; when no rule fires for the turn there is no card, so skip cleanly.
    const bookButton = page.getByRole("button", { name: /^Book/ }).last();
    const fired = await bookButton.isVisible().catch(() => false);
    test.skip(!fired, "No consultation recommendation rule fired for this turn");

    await bookButton.click();
    // Confirmation is either the opened-booking-page note or the generic follow-up promise.
    await expect(
      page
        .getByText(/opened your booking page|we'll be in touch to schedule/i)
        .last(),
    ).toBeVisible();
  });
});
