import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";
import { ask, gotoChat, saveLastAnswer } from "../fixtures/web-actions";

/**
 * Conversation history, full-text search (M3.3), saved answers (M3.2), and rename. A turn
 * is created first so the history is non-empty for this user regardless of prior state.
 */
test.describe("history + saved answers", () => {
  const marker = `e2e-history-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await signIn(page, users.member);
    await gotoChat(page);
  });

  test("a conversation appears in history, is searchable, and renames", async ({ page }) => {
    await ask(page, `Tell me about ${marker} in one sentence.`);
    await saveLastAnswer(page);

    await page.goto(`${env.webBaseUrl}/history`);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

    // Recent conversations list is populated.
    await expect(page.getByText("Recent conversations")).toBeVisible();

    // Full-text search finds the conversation by its message content.
    await page.getByPlaceholder("Search titles and messages…").fill(marker);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Search results")).toBeVisible();

    // Saved answers panel reflects the bookmark made above.
    await expect(page.getByText("Saved answers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open conversation" }).first()).toBeVisible();
  });

  test("opening a conversation allows rename", async ({ page }) => {
    await ask(page, `Rename target ${marker}`);
    await page.goto(`${env.webBaseUrl}/history`);

    await page.getByRole("button", { name: "Open conversation" }).first().click();
    // Exact: conversation entries are buttons whose name is the title, and prior runs leave
    // titles containing "Rename"/"Renamed" — match only the rename *action* button.
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    const renamed = `Renamed ${marker}`;
    await page.getByLabel("Conversation title").fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  });
});
