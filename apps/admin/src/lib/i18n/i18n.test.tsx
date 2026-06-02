/**
 * Admin/expert portal i18n tests (M15.2.7). Three concerns, mirroring the web suite
 * (M15.1.5) but adapted to the admin layer's per-page-namespace dictionaries + the
 * `useStatusLabel` lifecycle-label hook:
 *
 *  1. Locale provider — the real admin `LocaleProvider` resolves `useT`/`useLocale`,
 *     `setLocale` flips the UI language and writes through to localStorage
 *     (`expertos:admin-locale`) + the profile (`PATCH /me/locale`), the resolution order
 *     (localStorage pref > profile seed) holds, and a missing key + interpolation behave.
 *  2. `useStatusLabel` — every one of the shared `common.status.*` lifecycle tokens maps
 *     to its localized label in EN and VI, and an unmapped token falls back to the
 *     humanized (underscore→space) English form so a new status never breaks the UI.
 *  3. Dictionary lockstep — EN and VI stay in lockstep across every namespace (identical
 *     namespace set, identical leaf-key set, every leaf a non-empty string, matching
 *     `{placeholder}` interpolation tokens), so no `useT` call falls back to a raw token.
 */
import type { Locale, Messages } from "@expertos/ui";
import { useLocale, useStatusLabel, useT } from "./index";
import { MESSAGES } from "./dictionaries";
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  apiCalls,
  mockApi,
  makeMockUser,
} from "../../../test/render";

const LOCALE_STORAGE_KEY = "expertos:admin-locale";

// Walk a dot-path to a branch node (throws if it lands on a string/leaf or a gap).
function branch(messages: Messages, path: string): Messages {
  return path.split(".").reduce<Messages>((node, part) => {
    const next = (node as Record<string, string | Messages>)[part];
    if (typeof next !== "object" || next === null) {
      throw new Error(`Expected a branch node at "${path}" (part "${part}")`);
    }
    return next;
  }, messages);
}

// The shared lifecycle-status catalog drives `useStatusLabel`; derive the token list from EN
// so the "all 43 tokens" assertion self-verifies against the real dictionary.
const STATUS_TOKENS = Object.keys(branch(MESSAGES.en, "common.status"));
const EN_STATUS = branch(MESSAGES.en, "common.status") as Record<string, string>;
const VI_STATUS = branch(MESSAGES.vi, "common.status") as Record<string, string>;

// A probe exposing the active locale, a translated string, an interpolated string, and a
// deliberately-missing key (to assert the greppable-token fallback), plus a switch button.
function LocaleProbe() {
  const { locale, setLocale } = useLocale();
  const t = useT("dashboard");
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t("greetingLine", { greeting: "Good morning", name: "Mai" })}</span>
      <span data-testid="missing">{t("does.not.exist")}</span>
      <button onClick={() => setLocale(locale === "en" ? "vi" : "en")}>toggle</button>
    </div>
  );
}

describe("admin LocaleProvider switching", () => {
  it("defaults to EN and resolves EN strings + interpolation", async () => {
    renderWithProviders(<LocaleProbe />);
    expect(await screen.findByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("title")).toHaveTextContent("Good morning, Mai");
  });

  it("falls back to the dot-path key for a missing string", async () => {
    renderWithProviders(<LocaleProbe />);
    expect(await screen.findByTestId("missing")).toHaveTextContent("does.not.exist");
  });

  it("switches the UI language and persists to localStorage + the profile", async () => {
    mockApi("PATCH", "/me/locale", { body: { locale: "vi" } });
    renderWithProviders(<LocaleProbe />, { user: makeMockUser() });

    await screen.findByTestId("title");
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("vi"));
    // The VI greeting line interpolates the same args (placeholder lockstep verified below).
    expect(screen.getByTestId("title")).toHaveTextContent("Mai");
    // Same-device cache written synchronously.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("vi");
    // Cross-device persistence: PATCH /me/locale with the chosen locale.
    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/me/locale",
      );
      expect(patch?.body).toEqual({ locale: "vi" });
    });
  });

  it("restores a same-device localStorage preference (VI) over the EN profile", async () => {
    // `locale: "vi"` seeds localStorage; the GET /me profile seed is skipped for a local pref.
    mockApi("GET", "/me", { body: { locale: "en" } });
    renderWithProviders(<LocaleProbe />, { locale: "vi" });
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("vi"));
  });

  it("seeds from the user profile locale when no same-device preference exists", async () => {
    mockApi("GET", "/me", { body: { locale: "vi" } });
    renderWithProviders(<LocaleProbe />, { user: makeMockUser() });
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("vi"));
  });
});

// A probe rendering every lifecycle token through `useStatusLabel`, plus one unknown token.
function StatusProbe() {
  const statusLabel = useStatusLabel();
  return (
    <ul>
      {STATUS_TOKENS.map((tok) => (
        <li key={tok} data-testid={`status-${tok}`}>
          {statusLabel(tok)}
        </li>
      ))}
      <li data-testid="status-unknown">{statusLabel("some_new_status")}</li>
    </ul>
  );
}

describe("useStatusLabel lifecycle labels", () => {
  it("covers the full 43-token lifecycle-status catalog", () => {
    expect(STATUS_TOKENS).toHaveLength(43);
  });

  it("maps every status token to its localized EN label", async () => {
    renderWithProviders(<StatusProbe />);
    await screen.findByTestId(`status-${STATUS_TOKENS[0]}`);
    for (const tok of STATUS_TOKENS) {
      expect(screen.getByTestId(`status-${tok}`)).toHaveTextContent(EN_STATUS[tok]);
    }
  });

  it("maps every status token to its localized VI label", async () => {
    // Seed the VI preference so the provider restores it after mount.
    renderWithProviders(<StatusProbe />, { locale: "vi" });
    await waitFor(() =>
      expect(screen.getByTestId(`status-${STATUS_TOKENS[0]}`)).toHaveTextContent(
        VI_STATUS[STATUS_TOKENS[0]],
      ),
    );
    for (const tok of STATUS_TOKENS) {
      expect(screen.getByTestId(`status-${tok}`)).toHaveTextContent(VI_STATUS[tok]);
    }
  });

  it("falls back to the humanized (underscore→space) form for an unmapped token", async () => {
    renderWithProviders(<StatusProbe />);
    expect(await screen.findByTestId("status-unknown")).toHaveTextContent("some new status");
  });
});

describe("dictionary key completeness (lockstep across all namespaces)", () => {
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

  it("has the identical top-level namespace set in EN and VI", () => {
    const enNamespaces = Object.keys(MESSAGES.en).sort();
    const viNamespaces = Object.keys(MESSAGES.vi).sort();
    expect(viNamespaces).toEqual(enNamespaces);
    // Sanity: the admin portal spans many page namespaces, not a single bag of strings.
    expect(enNamespaces.length).toBeGreaterThan(20);
  });

  it("has the identical leaf-key set in EN and VI (lockstep)", () => {
    expect(viKeys).toEqual(enKeys);
  });

  it("resolves every key to a non-empty string in both locales", () => {
    for (const locale of ["en", "vi"] as Locale[]) {
      for (const key of enKeys) {
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
    const placeholders = (locale: Locale, key: string): string[] => {
      const leaf = key.split(".").reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        MESSAGES[locale],
      );
      return (String(leaf).match(/\{(\w+)\}/g) ?? []).sort();
    };
    for (const key of enKeys) {
      expect(placeholders("vi", key)).toEqual(placeholders("en", key));
    }
  });
});
