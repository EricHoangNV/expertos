import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { users } from "../fixtures/env";
import { gotoChat } from "../fixtures/web-actions";

/**
 * "My Knowledge" management surface (M18.4.1). M5 lets a user attach a document and choose
 * Persistent (indexed into their private knowledge); M18 closes the loop with a read+delete page.
 * This walks the full round-trip a real user takes: upload a persistent file in chat → reach
 * My Knowledge from the sidebar entry point (the actual UX fix — "where did my remembered file
 * go?") → confirm it landed with its green Saved badge and a searchable-chunk count → delete it
 * with the confirm step → confirm the row is gone.
 *
 * The filename is per-run unique so a re-run on the shared DB never collides; the row is also
 * userId-scoped, so the global teardown reclaims it even if a leg fails before the delete.
 */
test.describe("my knowledge", () => {
  test("a persistent upload appears in My Knowledge and can be deleted", async ({ page }) => {
    const filename = `e2e-my-knowledge-${Date.now()}.csv`;

    await signIn(page, users.member);
    await gotoChat(page);

    // Upload a persistent CSV via the attach popover (M12.6.2) — persistent mode indexes it into
    // the user's private knowledge, so it must surface on the My Knowledge page.
    await page.getByRole("button", { name: "Attach document" }).click();
    await expect(page.getByLabel("Mode")).toBeVisible();
    await page.getByLabel("Mode").selectOption("persistent");

    const csv = ["region,revenue,year", "North,120000,2024", "South,98000,2024"].join("\n");
    await page.getByLabel("Choose a document to upload").setInputFiles({
      name: filename,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    // The in-chat upload row confirms the file was accepted and indexed before we navigate away.
    await expect(page.getByText(filename)).toBeVisible({ timeout: 30_000 });

    // The sidebar entry point (M18.3.3) is the discoverable answer to "where did my file go?".
    await page.getByRole("link", { name: "My Knowledge" }).click();
    await expect(page.getByRole("heading", { name: "My Knowledge" })).toBeVisible();

    // It appears in the Saved section: the row carries the file, the green "Saved" mode badge,
    // and a searchable-chunk count (a CSV parses into > 0 chunks).
    await expect(page.getByText(filename)).toBeVisible();
    await expect(page.getByText(/searchable chunk/i)).toBeVisible();

    // Delete it with the confirm step; the row disappears.
    await page.getByRole("button", { name: `Delete ${filename}` }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(filename)).toHaveCount(0);
  });
});
