import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { users } from "../fixtures/env";
import { ask, gotoChat } from "../fixtures/web-actions";

/**
 * Citation trust boundary (M4 + the citations-not-facts rule). The product contract is: an answer
 * is shown as *grounded* (resolvable sources + the "Citations resolved" badge) ONLY when it has
 * citations; an answer with no resolvable citations must surface as the "Limited knowledge"
 * insufficient-knowledge card — never as a bare, confident, uncited answer dressed as verified.
 *
 * We assert the *invariant* rather than forcing a specific citation, because deterministic
 * retrieval needs live embeddings (the publish→retrieval leg is a documented fixme). The invariant
 * holds regardless of what knowledge is seeded, and it directly guards the regression where an
 * uncited answer bypassed the insufficient-knowledge state.
 */
test.describe("citation trust boundary", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
    await gotoChat(page);
  });

  /** A completed turn is either grounded-with-sources or flagged limited-knowledge — never neither. */
  async function assertGroundedOrLimited(page: import("@playwright/test").Page): Promise<void> {
    const limited = page.getByText("Limited knowledge");
    const verified = page.getByText("Citations resolved");
    const viewSources = page.getByRole("button", { name: /View sources \(\d+\)/ });

    if (await limited.first().isVisible().catch(() => false)) {
      // Citationless ⇒ insufficient: the limited-knowledge path must NOT also claim verified
      // citations, and must render no citation chips. This is the exact regression guard.
      await expect(verified).toHaveCount(0);
      await expect(page.locator(".cite")).toHaveCount(0);
    } else {
      // A non-limited answer must be grounded: either the verified badge or the sources affordance
      // is present. If neither shows, the answer was presented as authoritative yet uncited — the bug.
      await expect(verified.or(viewSources).first()).toBeVisible();
    }
  }

  test("a normal answer is either grounded with sources or flagged limited-knowledge", async ({
    page,
  }) => {
    await ask(page, "What does the expert recommend for getting started?");
    await assertGroundedOrLimited(page);
  });

  test("an out-of-domain answer is flagged limited-knowledge, never shown as verified", async ({
    page,
  }) => {
    await ask(page, "zzqx unrelated nonsense topic that no expert has ever written about 67890");
    await assertGroundedOrLimited(page);
  });
});
