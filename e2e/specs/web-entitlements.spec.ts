import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { users } from "../fixtures/env";
import { gotoChat } from "../fixtures/web-actions";

/**
 * Plan-entitlement enforcement on document upload (M6.1 + the `document_upload` guard). The upload
 * route is server-gated by `@RequiresEntitlement("document_upload")`; a plan without that feature
 * gets a 402 *before* any parse/embed work. We sign in as `users.other` — a consumer with no
 * seeded subscription, i.e. the Free plan — and assert the upload is rejected, guarding the
 * regression where the entitlement was defined but never enforced.
 *
 * There is no client-side entitlement gate (both upload modes always render); the block is the
 * server 402, surfaced by the upload client as a red error badge. The entitlement-denied payload
 * carries no `message`, so the upload client throws a typed `UploadEntitlementError` the panel
 * localizes into a friendly upgrade prompt ("Document upload isn't included in your plan." + an
 * "Upgrade to add documents →" link to /account); this spec asserts the *rejection* (the red badge
 * + no indexing), deliberately not the wording, so it stays green regardless of copy.
 */
test.describe("upload entitlement enforcement (Free plan)", () => {
  test("a Free-plan user's document upload is rejected by the entitlement guard", async ({ page }) => {
    await signIn(page, users.other);
    await gotoChat(page);

    // Open the attach-document popover (M12.6.2) and pick persistent mode.
    await page.getByRole("button", { name: "Attach document" }).click();
    await expect(page.getByLabel("Mode")).toBeVisible();
    await page.getByLabel("Mode").selectOption("persistent");

    // A valid CSV — the same shape the paid member indexes successfully in web-upload.spec.ts — so a
    // rejection here is the plan boundary, not a bad file.
    const csv = ["region,revenue,year", "North,120000,2024"].join("\n");
    await page.getByLabel("Choose a document to upload").setInputFiles({
      name: "e2e-free-upload.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    // The document_upload guard rejects (402) before any parse/embed work: a red error badge shows
    // and the file never indexes. We assert the *rejection* (the security contract), not the badge
    // wording — the panel localizes the entitlement-denied 402 into a friendly upgrade prompt
    // (EN/VI), so the copy may evolve while the red-badge rejection contract holds.
    await expect(page.locator(".badge-red")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/searchable chunks/i)).toHaveCount(0);
  });
});
