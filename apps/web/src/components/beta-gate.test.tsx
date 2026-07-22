// Private-beta boundary tests — the `BetaGateBoundary` (root layout) + the `AuthProvider.denied`
// state it reads. Renders through the real Auth + Locale providers (M15.1.1 harness), so the
// `GET /me` beta-gate check actually runs: a 403 with `code: BETA_ACCESS_DENIED` flips `denied`
// and swaps the page for the deny card; anything else leaves the page untouched.
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  mockApi,
  getMockRouter,
} from "../../test/render";
import { BetaGateBoundary } from "./beta-gate";

// The real `AuthProvider` imports `signOut` from the auto-mocked `firebase/auth`; require the
// same module instance so a spy observes the deny screen's sign-out call.
function authMock(): typeof import("firebase/auth") {
  return require("firebase/auth");
}

describe("BetaGateBoundary", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the page for a signed-in, whitelisted user (GET /me succeeds)", async () => {
    renderWithProviders(
      <BetaGateBoundary>
        <div>the app</div>
      </BetaGateBoundary>,
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("ExpertOS is invite-only right now")).not.toBeInTheDocument(),
    );
  });

  it("renders the page for a signed-out visitor (the login route is unaffected)", async () => {
    renderWithProviders(
      <BetaGateBoundary>
        <div>login page</div>
      </BetaGateBoundary>,
      { user: null },
    );

    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("swaps the page for the deny card on a 403 BETA_ACCESS_DENIED", async () => {
    mockApi("GET", "/me", {
      status: 403,
      body: { message: "ExpertOS is in private beta.", code: "BETA_ACCESS_DENIED" },
    });
    renderWithProviders(
      <BetaGateBoundary>
        <div>the app</div>
      </BetaGateBoundary>,
    );

    expect(await screen.findByText("ExpertOS is invite-only right now")).toBeInTheDocument();
    expect(screen.getByText("Private beta")).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
  });

  it("does not deny on a 403 without the beta code (e.g. a role rejection)", async () => {
    mockApi("GET", "/me", { status: 403, body: { message: "Forbidden" } });
    renderWithProviders(
      <BetaGateBoundary>
        <div>the app</div>
      </BetaGateBoundary>,
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("ExpertOS is invite-only right now")).not.toBeInTheDocument(),
    );
  });

  it("does not deny on a transient server error", async () => {
    mockApi("GET", "/me", { status: 500, body: { message: "boom" } });
    renderWithProviders(
      <BetaGateBoundary>
        <div>the app</div>
      </BetaGateBoundary>,
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
  });

  it("signs the denied user out and navigates to the login page", async () => {
    const signOut = jest.spyOn(authMock(), "signOut");
    mockApi("GET", "/me", {
      status: 403,
      body: { message: "ExpertOS is in private beta.", code: "BETA_ACCESS_DENIED" },
    });
    renderWithProviders(
      <BetaGateBoundary>
        <div>the app</div>
      </BetaGateBoundary>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    // The deny card usually shows while the URL sits on /chat (the login page redirects before the
    // deny resolves), so sign-out must route home explicitly — not leave the user stranded there.
    await waitFor(() => expect(getMockRouter().replace).toHaveBeenCalledWith("/"));
  });
});
