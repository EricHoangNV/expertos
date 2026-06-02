// Shared render helper for admin/expert portal page/component tests (M15.2.1).
//
// Wraps the unit under test in the REAL `AuthProvider` + `LocaleProvider` (so their own
// logic — the `POST /me/admin-session` whitelist/role resolution and the locale seed/persist —
// is exercised for coverage) on top of the firebase + fetch mocks. A test controls who is
// signed in, what role/denied state the session resolves to, and what locale resolves via the
// options below. Mirrors `apps/web/test/render.tsx`, adapted to the admin auth gate (M14).

import { type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { Locale } from "@expertos/ui";
import type { AllowedEmailRole } from "@expertos/shared";
import { AuthProvider } from "../src/lib/auth-context";
import { LocaleProvider } from "../src/lib/i18n";
import { makeMockUser, setMockUser, type MockUser } from "./auth-state";
import { hasApiMock, mockApi } from "./api-mock";

/** localStorage key for the admin-portal locale preference (distinct from the web app key). */
const LOCALE_STORAGE_KEY = "expertos:admin-locale";

export interface RenderOptions {
  /** The signed-in user (default: a `member@example.com` mock). Pass `null` for signed-out. */
  user?: MockUser | null;
  /**
   * The role the `POST /me/admin-session` whitelist gate resolves to (default `admin`). Ignored
   * when `denied` is set or the user is signed out. Drives the role-aware nav (admin vs expert).
   */
  role?: AllowedEmailRole;
  /**
   * When true, the admin-session call resolves to a 403 — the email is not whitelisted — so the
   * `AuthProvider` flips `denied` (the Access Denied gate, M14). Default false.
   */
  denied?: boolean;
  /**
   * Active UI locale. When provided it is seeded into localStorage so the provider restores it
   * (and the profile `GET /me` locale seed is skipped, mirroring a returning device). When omitted
   * the locale resolves from the `GET /me` profile response (default `en`).
   */
  locale?: Locale;
}

/**
 * Render `ui` inside the auth + locale providers. Sets the mock auth user before mount (so
 * `onAuthStateChanged` fires with it synchronously), then registers default responses for the
 * admin-session role resolution and the locale-profile seed unless the test already mocked them.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult {
  const { user = makeMockUser(), role = "admin", denied = false, locale } = options;
  setMockUser(user);
  if (locale) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  // The whitelist gate (M14): a whitelisted email returns the synced role; a non-whitelisted one
  // gets a 403, which the AuthProvider maps to `denied`.
  if (!hasApiMock("POST", "/me/admin-session")) {
    mockApi(
      "POST",
      "/me/admin-session",
      denied
        ? { status: 403, body: { reason: "not_whitelisted" } }
        : {
            body: {
              ok: true,
              role,
              user: {
                id: user?.uid ?? "u_test",
                email: user?.email ?? "member@example.com",
                displayName: user?.displayName ?? null,
              },
            },
          },
    );
  }
  if (!hasApiMock("GET", "/me")) {
    mockApi("GET", "/me", { body: { locale: locale ?? "en" } });
  }
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>
      <LocaleProvider>{children}</LocaleProvider>
    </AuthProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

// Re-export the Testing Library surface so tests import everything from one place.
export * from "@testing-library/react";
export { makeMockUser, setMockUser } from "./auth-state";
export { mockApi, apiCalls, resetApiMocks } from "./api-mock";
export { getMockRouter, setMockPathname } from "./router-state";
