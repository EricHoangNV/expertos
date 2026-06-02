import { test, expect } from "@playwright/test";
import { getEmulatorIdToken, signInAdmin } from "../fixtures/auth";
import { env, users } from "../fixtures/env";

/**
 * Admin/Expert portal internationalization (M13.3, task M15.3.1). The AdminFrame topbar carries
 * an EN/VI `.seg` toggle that switches the whole portal locale and persists it (localStorage
 * `expertos:admin-locale` + `PATCH /me/locale`), so nav groups, the role badge, and page headers
 * all switch language and the choice survives navigation.
 *
 * Sidebar labels render the dictionary value uppercased by CSS; Playwright matches `textContent`,
 * so the (Vietnamese) labels are matched case-insensitively.
 */
test.describe("admin i18n (EN ↔ VI)", () => {
  // The toggle persists VI to the admin's profile (`PATCH /me/locale`); since the profile seeds
  // the portal locale on sign-in, reset it to English afterwards (failure-safe via the API) so the
  // other admin specs that assert English labels aren't served Vietnamese.
  test.afterEach(async ({ request }) => {
    const token = await getEmulatorIdToken(request, users.admin);
    await request.patch(`${env.apiBaseUrl}/me/locale`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { locale: "en" },
    });
  });

  test("the locale toggle switches nav, role badge, and page headers to Vietnamese", async ({
    page,
  }) => {
    await signInAdmin(page, users.admin);

    // English baseline: an OPERATE group + the "Admin view" role badge.
    await expect(page.getByText(/^operate$/i).first()).toBeVisible();
    await expect(page.getByText(/^admin view$/i).first()).toBeVisible();

    // Toggle EN → VI (the "VI" segment is unique — the dashboard range control is 7d/30d/QTD).
    await page.getByRole("button", { name: "VI", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");

    // Nav group label, role badge, and an admin-only link now render in Vietnamese.
    await expect(page.getByText(/^cổng chuyên gia$/i).first()).toBeVisible(); // "Expert portal"
    await expect(page.getByText(/chế độ quản trị/i).first()).toBeVisible(); // "Admin view"
    await expect(
      page.getByRole("link", { name: "Người dùng & Đăng ký", exact: true }),
    ).toBeVisible(); // "Users & Subscriptions"

    // The locale persists across navigation: the knowledge page header renders in Vietnamese.
    await page.goto(`${env.adminBaseUrl}/knowledge`);
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.getByRole("heading", { name: "Duyệt kiến thức" })).toBeVisible();
  });
});
