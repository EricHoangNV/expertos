import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Expert voice-profile sign-off (M2.3 / M13.5). The voice profile lifecycle is a state machine
 * (draft → expert_review → published); from `expert_review` an "Approve" publishes
 * the voice ("Approving publishes this voice — it becomes eligible to render answers"). There is no
 * single "Publish" button.
 *
 * `global-setup.ts` seeds a profile ("Ada — awaiting sign-off") parked at expert_review for the
 * e2e expert (reset every run), so a single Approve publishes it. Signs in as the **expert** —
 * voice sign-off lives in the Expert Portal.
 */
const SIGNOFF_VOICE_NAME = "Ada — awaiting sign-off";

test.describe("expert voice sign-off", () => {
  test("an expert approves a voice profile awaiting sign-off and it publishes", async ({ page }) => {
    await signInAdmin(page, users.expert);
    await page.goto(`${env.adminBaseUrl}/voice-profiles`);

    // The seeded profile awaiting sign-off is listed.
    await expect(page.getByText(SIGNOFF_VOICE_NAME)).toBeVisible();

    // Only an expert_review profile offers "Approve"; the seeded one is the sole such profile, so
    // approving it publishes the voice and surfaces the green "Approve done." confirmation.
    const approve = page.getByRole("button", { name: "Approve" }).first();
    await expect(approve).toBeVisible();
    await approve.click();

    await expect(page.getByText("Approve done.")).toBeVisible();
  });
});
