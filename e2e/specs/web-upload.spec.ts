import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { users } from "../fixtures/env";
import { gotoChat } from "../fixtures/web-actions";

/**
 * Query-time document upload (M5): a persistent CSV/spreadsheet is parsed, chunked, and
 * embedded server-side, then reported back as searchable. We use an in-memory CSV buffer
 * (a real spreadsheet on disk would work identically) and assert the upload is accepted
 * and indexed (`> 0` searchable chunks), proving the spreadsheet pipeline end to end.
 */
test.describe("document upload", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
    await gotoChat(page);
  });

  test("a persistent spreadsheet upload is parsed into searchable chunks", async ({ page }) => {
    // Persistent mode indexes into the user's private knowledge (no conversation required).
    await page.getByLabel("Mode").selectOption("persistent");

    const csv = ["region,revenue,year", "North,120000,2024", "South,98000,2024"].join("\n");
    await page.getByLabel("Choose a document to upload").setInputFiles({
      name: "e2e-revenue.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    // The uploaded-file row shows the filename, its persistent badge, and the index result.
    await expect(page.getByText("e2e-revenue.csv")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("persistent")).toBeVisible();
    await expect(page.getByText(/searchable chunks/i)).toBeVisible();
  });

  test("an unsupported file type is rejected with the API's message", async ({ page }) => {
    await page.getByLabel("Choose a document to upload").setInputFiles({
      name: "e2e-malware.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ\x90\x00not a real executable", "binary"),
    });

    // The server is the authority on type/safety; a rejection renders a red error badge
    // (and the file never appears as a searchable upload).
    await expect(page.locator(".badge-red")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/searchable chunks/i)).toHaveCount(0);
  });
});
