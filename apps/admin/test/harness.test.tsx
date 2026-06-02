// Smoke tests for the admin/expert portal jest harness (M15.2.1). They prove the
// pieces wire together: the firebase auth mock drives the real AuthProvider, the
// admin-session whitelist gate resolves role/denied, the locale provider switches
// EN↔VI, and the fetch mock routes by `METHOD pathname`.
import { useEffect } from "react";
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  makeMockUser,
  mockApi,
  apiCalls,
} from "./render";
import { useAuth } from "../src/lib/auth-context";
import { useLocale } from "../src/lib/i18n";

/** Probe that surfaces the auth + locale context state into the DOM for assertions. */
function Probe() {
  const { user, role, denied, loading } = useAuth();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="email">{user?.email ?? "signed-out"}</span>
      <span data-testid="role">{role ?? "none"}</span>
      <span data-testid="denied">{String(denied)}</span>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => setLocale("vi")}>to vi</button>
    </div>
  );
}

describe("admin test harness", () => {
  it("resolves an admin session for a signed-in whitelisted admin", async () => {
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    expect(screen.getByTestId("email")).toHaveTextContent("member@example.com");
    expect(screen.getByTestId("denied")).toHaveTextContent("false");
    // The session POST was actually made by the real AuthProvider.
    expect(apiCalls().some((c) => c.method === "POST" && c.pathname === "/me/admin-session")).toBe(
      true,
    );
  });

  it("resolves the expert role when the session grants it", async () => {
    renderWithProviders(<Probe />, { role: "expert" });
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("expert"));
  });

  it("flips denied when the session returns 403 (not whitelisted)", async () => {
    renderWithProviders(<Probe />, { denied: true });
    await waitFor(() => expect(screen.getByTestId("denied")).toHaveTextContent("true"));
    expect(screen.getByTestId("role")).toHaveTextContent("none");
  });

  it("renders the signed-out state when there is no user", async () => {
    renderWithProviders(<Probe />, { user: null });
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("email")).toHaveTextContent("signed-out");
    expect(screen.getByTestId("role")).toHaveTextContent("none");
  });

  it("switches the active locale EN→VI and persists to the profile", async () => {
    mockApi("PATCH", "/me/locale", { body: { locale: "vi" } });
    renderWithProviders(<Probe />);
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    fireEvent.click(screen.getByText("to vi"));
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("vi"));
    expect(window.localStorage.getItem("expertos:admin-locale")).toBe("vi");
    await waitFor(() =>
      expect(
        apiCalls().some((c) => c.method === "PATCH" && c.pathname === "/me/locale"),
      ).toBe(true),
    );
  });

  it("seeds the locale from the profile GET /me response", async () => {
    mockApi("GET", "/me", { body: { locale: "vi" } });
    renderWithProviders(<Probe />, { user: makeMockUser() });
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("vi"));
  });
});
