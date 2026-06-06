import { test, expect } from "@playwright/test";
import { signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";
import { ask, gotoChat, saveLastAnswer } from "../fixtures/web-actions";

/**
 * Cross-user data isolation (RLS — P0.2). One user's conversations and saved answers must never
 * be visible to another. This drives the real two-identity scenario the suite seeds for but never
 * exercised: `users.member` creates + saves a uniquely-titled conversation, then `users.other`
 * signs in and must NOT find it via history search or the saved-answers panel.
 *
 * History rows are labeled by their conversation *title* (the row button's accessible name), so a
 * leak would surface as that title appearing for the other user; a correct isolation boundary
 * shows the empty-state copy instead.
 */
test.describe("cross-user isolation", () => {
  // A title unique to this run so the assertions can't pass/fail on stale data from a prior run.
  const marker = `e2e-isolation-${Date.now()}`;
  const renamed = `Isolation case ${marker}`;

  test("one user's saved conversation is not visible to another user", async ({ browser }) => {
    // --- member: create + title + save a conversation -----------------------------------------
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    try {
      await signIn(memberPage, users.member);
      await gotoChat(memberPage);
      await ask(memberPage, `Private note about ${marker} — only I should see this.`);
      await saveLastAnswer(memberPage);

      // Rename the conversation to the unique marker title so we assert on a deterministic string.
      await memberPage.goto(`${env.webBaseUrl}/history`);
      // Saved answers (and their "Open conversation" jump) live behind their own tab (M19.1.1).
      await memberPage.getByRole("tab", { name: "Saved answers" }).click();
      await memberPage.getByRole("button", { name: "Open conversation" }).first().click();
      await memberPage.getByRole("button", { name: "Rename", exact: true }).click();
      await memberPage.getByLabel("Conversation title").fill(renamed);
      await memberPage.getByRole("button", { name: "Save", exact: true }).click();
      await expect(memberPage.getByRole("heading", { name: renamed })).toBeVisible();
    } finally {
      await memberCtx.close();
    }

    // --- other: must not see the member's conversation ----------------------------------------
    const otherCtx = await browser.newContext();
    const otherPage = await otherCtx.newPage();
    try {
      await signIn(otherPage, users.other);
      await otherPage.goto(`${env.webBaseUrl}/history`);
      await expect(otherPage.getByRole("heading", { name: "History" })).toBeVisible();

      // Full-text search for the member's marker returns nothing for this user.
      await otherPage.getByPlaceholder("Search titles and messages…").fill(marker);
      await otherPage.getByRole("button", { name: "Search" }).click();
      await expect(otherPage.getByText("Search results")).toBeVisible();
      await expect(otherPage.getByText("No conversations matched.")).toBeVisible();

      // The member's conversation title is never rendered as a row for the other user.
      await expect(otherPage.getByRole("button", { name: renamed })).toHaveCount(0);
      // …and its saved answer never leaks into the other user's saved-answers panel.
      await expect(otherPage.getByRole("button", { name: renamed })).toHaveCount(0);
    } finally {
      await otherCtx.close();
    }
  });
});
