/**
 * Web i18n tests (M15.1.5). Three concerns:
 *
 *  1. Locale provider switching — the real `LocaleProvider` resolves `useT`/`useLocale`,
 *     `setLocale` flips the UI language and writes through to localStorage + the profile
 *     (`PATCH /me/locale`), and the resolution order (localStorage pref > profile seed) holds.
 *  2. Dictionary key completeness — EN and VI stay in lockstep (same key set, every leaf a
 *     string), so no `useT` call falls back to a raw key token in either language.
 *  3. Locale-aware formatting — the active locale drives currency/date formatting (EN vs VI),
 *     proving the formatters are wired to the provider, not the ambient system locale.
 */
import { useState } from "react";
import {
  formatCurrency,
  formatDateTime,
  type Locale,
  type Messages,
} from "@expertos/ui";
import { useLocale, useT } from "./index";
import { MESSAGES } from "./dictionaries";
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  apiCalls,
  mockApi,
  makeMockUser,
} from "../../../test/render";

const LOCALE_STORAGE_KEY = "expertos:locale";

// A probe exposing the active locale, a translated string, an interpolated string, and a
// deliberately-missing key (to assert the greppable-token fallback), plus a switch button.
function LocaleProbe() {
  const { locale, setLocale } = useLocale();
  const t = useT("chat");
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t("emptyTitle")}</span>
      <span data-testid="interp">{t("askPlaceholder", { name: "Mai" })}</span>
      <span data-testid="missing">{t("does.not.exist")}</span>
      <button onClick={() => setLocale(locale === "en" ? "vi" : "en")}>toggle</button>
    </div>
  );
}

describe("LocaleProvider switching", () => {
  it("defaults to EN and resolves EN strings + interpolation", async () => {
    renderWithProviders(<LocaleProbe />);
    expect(await screen.findByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("title")).toHaveTextContent("Start a new conversation");
    expect(screen.getByTestId("interp")).toHaveTextContent(
      "Ask Mai anything about your business…",
    );
  });

  it("falls back to the dot-path key for a missing string", async () => {
    renderWithProviders(<LocaleProbe />);
    expect(await screen.findByTestId("missing")).toHaveTextContent("does.not.exist");
  });

  it("switches the UI language and persists to localStorage + the profile", async () => {
    mockApi("PATCH", "/me/locale", { body: { locale: "vi" } });
    const user = makeMockUser();
    const { getByRole } = renderWithProviders(<LocaleProbe />, { user });

    await screen.findByTestId("title");
    await act(async () => getByRole("button", { name: "toggle" }).click());

    expect(await screen.findByTestId("locale")).toHaveTextContent("vi");
    expect(screen.getByTestId("title")).toHaveTextContent("Bắt đầu cuộc trò chuyện mới");
    // Same-device cache written synchronously.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("vi");
    // Cross-device persistence: PATCH /me/locale with the chosen locale.
    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/me/locale",
      );
      expect(patch).toBeDefined();
      expect(patch?.body).toEqual({ locale: "vi" });
    });
  });

  it("restores a same-device localStorage preference (VI) over the EN profile", async () => {
    // `locale: "vi"` seeds localStorage; the GET /me profile seed is skipped for a local pref.
    renderWithProviders(<LocaleProbe />, { locale: "vi" });
    expect(await screen.findByTestId("locale")).toHaveTextContent("vi");
    expect(screen.getByTestId("title")).toHaveTextContent("Bắt đầu cuộc trò chuyện mới");
  });

  it("seeds from the user profile locale when no same-device preference exists", async () => {
    mockApi("GET", "/me", { body: { locale: "vi" } });
    renderWithProviders(<LocaleProbe />, { user: makeMockUser() });
    // The profile seed flips the default EN → VI after sign-in.
    await waitFor(() =>
      expect(screen.getByTestId("locale")).toHaveTextContent("vi"),
    );
  });
});

describe("dictionary key completeness", () => {
  // Collect every dot-path leaf key in a catalog (skips branch nodes).
  function leafKeys(messages: Messages, prefix = ""): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(messages)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") keys.push(path);
      else keys.push(...leafKeys(value, path));
    }
    return keys;
  }

  const enKeys = leafKeys(MESSAGES.en).sort();
  const viKeys = leafKeys(MESSAGES.vi).sort();

  it("has the identical key set in EN and VI (lockstep)", () => {
    expect(viKeys).toEqual(enKeys);
  });

  it("resolves every key to a non-empty string in both locales", () => {
    for (const locale of ["en", "vi"] as Locale[]) {
      for (const key of enKeys) {
        // Walk the dot-path; the leaf must be a non-empty string in this locale.
        const leaf = key.split(".").reduce<unknown>(
          (node, part) =>
            typeof node === "object" && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          MESSAGES[locale],
        );
        expect(typeof leaf).toBe("string");
        expect((leaf as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps EN and VI interpolation placeholders in lockstep per key", () => {
    // A `{name}` in EN must also exist in VI (and vice versa), or interpolation silently drops.
    const placeholders = (locale: Locale, key: string): string[] => {
      const leaf = key.split(".").reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        MESSAGES[locale],
      );
      const matches = String(leaf).match(/\{(\w+)\}/g) ?? [];
      return matches.sort();
    };
    for (const key of enKeys) {
      expect(placeholders("vi", key)).toEqual(placeholders("en", key));
    }
  });
});

describe("locale-aware formatting wired to the active locale", () => {
  // A probe formatting the same currency + date through the active locale.
  function FormatProbe() {
    const { locale, setLocale } = useLocale();
    const [, force] = useState(0);
    return (
      <div>
        <span data-testid="price">{formatCurrency(locale, 4.99, "USD")}</span>
        <span data-testid="date">
          {formatDateTime(locale, "2026-06-02T15:04:00Z", { dateStyle: "medium" })}
        </span>
        <button
          onClick={() => {
            setLocale("vi");
            force((n) => n + 1);
          }}
        >
          to-vi
        </button>
      </div>
    );
  }

  it("formats currency + dates per the EN locale, then switches to VI", async () => {
    mockApi("PATCH", "/me/locale", { body: { locale: "vi" } });
    const { getByRole } = renderWithProviders(<FormatProbe />);

    // EN: "$4.99" and a comma date.
    const price = await screen.findByTestId("price");
    expect(price).toHaveTextContent("$4.99");

    await act(async () => getByRole("button", { name: "to-vi" }).click());

    // VI: comma-decimal currency ("4,99 US$") + day-first date ("thg 6").
    await waitFor(() => expect(screen.getByTestId("price")).toHaveTextContent("4,99"));
    expect(screen.getByTestId("date")).toHaveTextContent("thg 6");
  });
});
