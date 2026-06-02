// Shared render helper for web page/component tests (M15.1.1).
//
// Wraps the unit under test in the REAL `AuthProvider` + `LocaleProvider` (so their
// own logic is exercised for coverage) on top of the firebase + fetch mocks. A test
// controls who is signed in and what locale resolves via the options below.

import { type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { Locale } from "@expertos/ui";
import { AuthProvider } from "../src/lib/auth-context";
import { LocaleProvider } from "../src/lib/i18n";
import { makeMockUser, setMockUser, type MockUser } from "./auth-state";
import { hasApiMock, mockApi } from "./api-mock";

const LOCALE_STORAGE_KEY = "expertos:locale";

export interface RenderOptions {
  /** The signed-in user (default: a `member@example.com` mock). Pass `null` for signed-out. */
  user?: MockUser | null;
  /**
   * Active UI/answer locale. When provided it is seeded into localStorage so the provider
   * restores it (and the profile `GET /me` seed is skipped, mirroring a returning device).
   * When omitted the locale resolves from the `GET /me` profile response (default `en`).
   */
  locale?: Locale;
}

/**
 * Render `ui` inside the auth + locale providers. Sets the mock auth user before
 * mount (so `onAuthStateChanged` fires with it synchronously). Registers a default
 * `GET /me` response for the locale-profile seed unless the test already mocked it.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult {
  const { user = makeMockUser(), locale } = options;
  setMockUser(user);
  if (locale) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
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
