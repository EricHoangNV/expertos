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
 * via the post-answer action bar (M12.4.4) — the "Helpful" feedback button renders only once
 * the assistant message has a persisted id, i.e. the `done` frame arrived.
 */
export async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("Ask a question…").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  // The send button reads "Answering…" while the turn streams. It does NOT re-enable on
  // completion (the input is cleared, so it stays disabled until the user types again), so the
  // robust done-signal is the post-answer action bar, which renders only once the assistant
  // message has a persisted id — i.e. the `done` frame arrived (M3.4). The "Helpful" feedback
  // button shows on every completed turn, including the insufficient-knowledge path.
  await expect(page.getByRole("button", { name: "Helpful" }).last()).toBeVisible({
    timeout: 45_000,
  });
}

/** Save the most recent answer; resolves once the "Saved" confirmation badge shows. */
export async function saveLastAnswer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  // Exact match: a loose "Saved" also matches the upload-mode option "Persistent (saved to my
  // knowledge)". The confirmation is the green badge whose text is exactly "Saved".
  await expect(page.getByText("Saved", { exact: true }).last()).toBeVisible();
}
