import { test, expect } from "@playwright/test";
import { getEmulatorIdToken, signIn } from "../fixtures/auth";
import { env, users } from "../fixtures/env";
import { gotoChat } from "../fixtures/web-actions";

/**
 * Consumer web UI internationalization (M13.1–M13.5, task M15.3.6). The topbar language toggle
 * switches the *entire* UI locale — not just the answer language — and persists it (localStorage
 * + `PATCH /me/locale`), so the choice carries across the chat, account, and history pages. This
 * drives the toggle EN→VI and asserts each page renders its Vietnamese labels.
 *
 * `<html lang>` tracks the active locale; the toggle's accessible name is "Answer language EN —
 * switch language" (the same control unifies UI + answer language since M13.1).
 */
test.describe("web i18n (EN ↔ VI)", () => {
  // This spec persists VI to the member's profile (`PATCH /me/locale`). The locale is a shared,
  // cross-test carrier (it seeds the UI on sign-in), so reset it to English afterwards —
  // failure-safe via the API — so later member specs aren't silently served in Vietnamese.
  test.afterEach(async ({ request }) => {
    const token = await getEmulatorIdToken(request, users.member);
    await request.patch(`${env.apiBaseUrl}/me/locale`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { locale: "en" },
    });
  });

  test("the language toggle switches the chat, account, and history UI to Vietnamese", async ({
    page,
  }) => {
    await signIn(page, users.member);
    await gotoChat(page);

    // English baseline.
    await expect(page.getByText("Start a new conversation")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // Toggle EN → VI: the chat shell re-renders in Vietnamese immediately.
    await page.getByRole("button", { name: /switch language/i }).click();
    await expect(page.getByText("Bắt đầu cuộc trò chuyện mới")).toBeVisible();
    await expect(page.getByPlaceholder(/Hỏi bất cứ điều gì/)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");

    // The locale persists to the other pages (localStorage + profile), so a fresh load of each
    // renders its Vietnamese heading rather than reverting to the English default.
    await page.goto(`${env.webBaseUrl}/account`);
    await expect(page.getByRole("heading", { name: "Gói & mức dùng" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");

    await page.goto(`${env.webBaseUrl}/history`);
    await expect(page.getByRole("heading", { name: "Lịch sử" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  });
});
