import { type Page, expect } from "@playwright/test";
import { env } from "./env";

/**
 * Shared interactions with the consumer chat page (`apps/web/app/chat`). Selectors are
 * accessibility-first (roles, labels, placeholders) so they track the rendered UI rather
 * than implementation detail.
 */

/** Navigate to the chat page (assumes an already signed-in context). */
export async function gotoChat(page: Page): Promise<void> {
  await page.goto(`${env.webBaseUrl}/chat`);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
}

/**
 * Ask `text` and wait for the assistant turn to finish streaming. Completion is observed
 * via the post-answer affordances ("Was this helpful?" appears only once the assistant
 * message has a persisted id, i.e. the `done` frame arrived).
 */
export async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("Ask a question…").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  // The send button flips to "Answering…" while busy, then back to "Send".
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByText("Was this helpful?").last()).toBeVisible({ timeout: 45_000 });
}

/** Save the most recent answer; resolves once the "Saved" confirmation badge shows. */
export async function saveLastAnswer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save answer" }).last().click();
  await expect(page.getByText("Saved").last()).toBeVisible();
}
