/**
 * Harness self-test (M15.1.1). Proves the shared test infrastructure works end to
 * end — the firebase auth mock feeds `useAuth`, the real `LocaleProvider` resolves
 * `useT` against the EN/VI dictionaries, and the locale seed switches the language —
 * so the page suites (M15.1.2–M15.1.6) can build on it.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../src/lib/auth-context";
import { useT } from "../src/lib/i18n";
import {
  renderWithProviders,
  screen,
  makeMockUser,
  mockApi,
  apiCalls,
  getMockRouter,
} from "./render";

function Probe() {
  const { user, loading } = useAuth();
  const t = useT("chat");
  if (loading) return <p>loading</p>;
  return (
    <div>
      <span data-testid="who">{user ? user.email : "signed-out"}</span>
      <span data-testid="title">{t("emptyTitle")}</span>
    </div>
  );
}

describe("web test harness", () => {
  it("signs in the mock user and resolves EN translations", async () => {
    renderWithProviders(<Probe />, { user: makeMockUser({ email: "a@b.com" }) });
    expect(await screen.findByTestId("who")).toHaveTextContent("a@b.com");
    expect(screen.getByTestId("title")).toHaveTextContent("Start a new conversation");
  });

  it("renders the signed-out state when no user is set", async () => {
    renderWithProviders(<Probe />, { user: null });
    expect(await screen.findByTestId("who")).toHaveTextContent("signed-out");
  });

  it("switches the UI language when the locale seed is VI", async () => {
    renderWithProviders(<Probe />, { locale: "vi" });
    expect(await screen.findByTestId("title")).toHaveTextContent(
      "Bắt đầu cuộc trò chuyện mới",
    );
  });

  it("exposes a controllable next/navigation router", async () => {
    function Redirector() {
      const router = useRouter();
      useEffect(() => router.replace("/chat"), [router]);
      return <span data-testid="ready">ok</span>;
    }
    renderWithProviders(<Redirector />);
    await screen.findByTestId("ready");
    expect(getMockRouter().replace).toHaveBeenCalledWith("/chat");
  });

  it("routes client fetches through the API mock", async () => {
    let seen = false;
    mockApi("GET", "/me", () => {
      seen = true;
      return { body: { locale: "en" } };
    });
    renderWithProviders(<Probe />);
    await screen.findByTestId("who");
    // The locale provider seeds from GET /me on sign-in.
    expect(seen).toBe(true);
    expect(apiCalls().some((c) => c.pathname === "/me")).toBe(true);
  });
});
