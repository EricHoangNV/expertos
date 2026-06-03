import { test, expect } from "@playwright/test";
import { signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Conversation → Knowledge pipeline surface (M8.2). The admin Knowledge page renders a
 * "Conversation → Knowledge" section: a static pipeline breadcrumb plus a table of drafts spawned
 * from conversations ("From chat: yes"), each with a "Draft" action linking to the draft editor.
 * There is no in-portal "mark valuable" button — drafts are created server-side — so this asserts
 * the read surface against a seeded conversation-sourced draft (`global-setup.ts`).
 */
const DRAFT_TITLE = "E2E Recurring Question Draft";

test.describe("conversation → knowledge", () => {
  test("a conversation-sourced draft appears in the admin knowledge pipeline", async ({ page }) => {
    await signInAdmin(page, users.admin);
    await page.goto(`${env.adminBaseUrl}/knowledge`);

    // The seeded conversation-sourced draft shows in the Conversation → Knowledge table, keyed by
    // its recurring-question title — proof the M8.2 pipeline surfaces chat-sourced drafts.
    const draftRow = page.getByRole("row").filter({ hasText: DRAFT_TITLE });
    await expect(draftRow).toBeVisible();

    // The row exposes its draft-editor action (rendered as a link/button to /knowledge-drafts/{id}).
    await expect(
      draftRow.locator('a[href*="/knowledge-drafts/"]').or(draftRow.getByRole("button", { name: "Draft" })).first(),
    ).toBeVisible();
  });
});
