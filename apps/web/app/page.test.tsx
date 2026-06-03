/**
 * Login / landing page (`/`, M12.8.2). The route shows the Google sign-in form to a
 * signed-out visitor and silently redirects a returning user with an active Firebase
 * session to `/chat` — the loading view stands in for both the initial auth resolution
 * and the in-flight redirect so the login form never flashes for an already-signed-in
 * user. This was the one `apps/web` page the M15.1 suite had not covered.
 */
import LoginPage from "./page";
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  makeMockUser,
  getMockRouter,
} from "../test/render";

// The real `AuthProvider` imports `signInWithPopup` from the auto-mocked `firebase/auth`;
// require the same module instance so a spy observes the page's sign-in call.
function authMock(): typeof import("firebase/auth") {
  return require("firebase/auth");
}

describe("login page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the sign-in form to a signed-out visitor and does not redirect", async () => {
    renderWithProviders(<LoginPage />, { user: null });

    expect(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Talk to an ExpertOS/i }),
    ).toBeInTheDocument();
    // Auth/legal disclosure with Terms + Privacy links (login-page requirement).
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    // A signed-out visitor stays on the login page — no redirect to /chat.
    expect(getMockRouter().replace).not.toHaveBeenCalled();
  });

  it("redirects a returning signed-in user to /chat without flashing the login form (M12.8.2)", async () => {
    renderWithProviders(<LoginPage />, { user: makeMockUser() });

    await waitFor(() => expect(getMockRouter().replace).toHaveBeenCalledWith("/chat"));
    // Only the loading view renders for an already-signed-in user — never the sign-in form.
    expect(
      screen.queryByRole("button", { name: /Continue with Google/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("invokes Google sign-in when the Continue button is clicked", async () => {
    const signIn = jest.spyOn(authMock(), "signInWithPopup");
    renderWithProviders(<LoginPage />, { user: null });

    fireEvent.click(
      await screen.findByRole("button", { name: /Continue with Google/i }),
    );

    await waitFor(() => expect(signIn).toHaveBeenCalled());
  });
});
