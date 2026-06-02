// AdminFrame tests (M15.2.2) — the shared admin/expert portal chrome. Covers the
// role-aware nav filtering (admin sees every group; an expert sees only the expert
// subset), the topbar breadcrumb + role badge, the `.navitem .tag` count badges
// (M13.1.2), the bottom-pinned identity footer + sign-out, and the M14 access-denied
// + sign-in gates. Renders through the real Auth + Locale providers (M15.2.1 harness),
// so the `POST /me/admin-session` role resolution runs for real.
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  makeMockUser,
  mockApi,
  setMockPathname,
} from "../../test/render";
import { AdminFrame } from "./AdminFrame";

/** A trivial page body so we can prove the frame renders its `children`. */
function Page() {
  return <div data-testid="page-body">page content</div>;
}

describe("AdminFrame — role-aware nav", () => {
  it("shows every nav group + admin-only items for a resolved admin", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "admin" });

    // The frame renders its children + the admin role badge once the session resolves.
    await screen.findByText("Admin view");
    expect(screen.getByTestId("page-body")).toBeInTheDocument();

    // All five group headers are present for an admin.
    for (const group of ["Operate", "Monetize", "Expert portal", "Analytics", "System"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    // Admin-only items render (MONETIZE / SYSTEM live behind the admin role).
    expect(screen.getByRole("link", { name: /Revenue/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Access control" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("hides admin-only groups + items for an expert", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "expert" });

    await screen.findByText("Expert view");

    // OPERATE + EXPERT PORTAL carry expert-visible items; the admin-only groups vanish.
    expect(screen.getByText("Operate")).toBeInTheDocument();
    expect(screen.getByText("Expert portal")).toBeInTheDocument();
    expect(screen.queryByText("Monetize")).not.toBeInTheDocument();
    expect(screen.queryByText("Analytics")).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();

    // Expert items show; admin-only items do not.
    expect(screen.getByRole("link", { name: "Voice profiles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Revenue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Access control" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });
});

describe("AdminFrame — breadcrumb + role badge", () => {
  it("renders the admin breadcrumb prefix + active page label", async () => {
    setMockPathname("/revenue");
    const { container } = renderWithProviders(<AdminFrame><Page /></AdminFrame>, {
      role: "admin",
    });

    await screen.findByText("Admin view");
    expect(container.querySelector(".crumb .label")?.textContent).toBe("Admin");
    expect(container.querySelector(".crumb-page")?.textContent).toBe("Revenue");
  });

  it("resolves the dashboard label for the root path", async () => {
    setMockPathname("/");
    const { container } = renderWithProviders(<AdminFrame><Page /></AdminFrame>, {
      role: "admin",
    });

    await screen.findByText("Admin view");
    expect(container.querySelector(".crumb-page")?.textContent).toBe("Dashboard");
  });

  it("renders the expert breadcrumb prefix + amber role badge", async () => {
    setMockPathname("/concierge-reviews");
    const { container } = renderWithProviders(<AdminFrame><Page /></AdminFrame>, {
      role: "expert",
    });

    await screen.findByText("Expert view");
    expect(container.querySelector(".crumb .label")?.textContent).toBe("Expert Portal");
    expect(container.querySelector(".crumb-page")?.textContent).toBe("Concierge queue");
  });
});

describe("AdminFrame — nav count badges", () => {
  it("renders `.tag` counts from the queue APIs", async () => {
    // Knowledge needing review (3), open concierge (requested 2 + in_review 1 = 3), flagged (7).
    mockApi("GET", "/knowledge/documents", { body: [{}, {}, {}] });
    mockApi("GET", "/concierge-reviews", (req) => {
      const status = new URL(req.url, "http://localhost").searchParams.get("status");
      return { body: status === "requested" ? [{}, {}] : [{}] };
    });
    mockApi("GET", "/admin/failed-queries", { body: [{}, {}, {}, {}, {}, {}, {}] });

    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "admin" });
    await screen.findByText("Admin view");

    // Badge text is appended to the nav item label, so the accessible name carries the count.
    expect(await screen.findByRole("link", { name: "Knowledge 3" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Concierge queue 3" })).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Low-confidence queries 7" }),
    ).toBeInTheDocument();
  });

  it("caps a large count at 99+", async () => {
    mockApi("GET", "/knowledge/documents", { body: Array.from({ length: 150 }, () => ({})) });

    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "admin" });
    await screen.findByText("Admin view");

    expect(await screen.findByRole("link", { name: "Knowledge 99+" })).toBeInTheDocument();
  });

  it("omits a badge when its API fails (stays null)", async () => {
    // Default 404s for every queue API → counts stay null → no `.tag` chips.
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "admin" });
    await screen.findByText("Admin view");

    // The bare label has no trailing count.
    expect(screen.getByRole("link", { name: "Knowledge" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /Knowledge \d/ })).not.toBeInTheDocument(),
    );
  });
});

describe("AdminFrame — identity footer + sign-out", () => {
  it("renders the avatar initials, display name + admin role label", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, {
      role: "admin",
      user: makeMockUser({ displayName: "Test Member" }),
    });

    await screen.findByText("Admin view");
    expect(screen.getByText("Test Member")).toBeInTheDocument();
    expect(screen.getByText("Admin · ExpertOS")).toBeInTheDocument();
    expect(screen.getByText("TM")).toBeInTheDocument(); // avatar initials
  });

  it("signs out when the footer button is clicked", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { role: "admin" });
    await screen.findByText("Admin view");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    // signOut clears the mock user → the frame falls back to the sign-in screen.
    await screen.findByText("Sign in to the console");
  });
});

describe("AdminFrame — auth gates", () => {
  it("shows the access-denied screen for a non-whitelisted email", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { denied: true });

    await screen.findByText("Access denied");
    // No portal chrome: nav groups and the page body are not rendered.
    expect(screen.queryByText("Operate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the sign-in screen when signed out", async () => {
    renderWithProviders(<AdminFrame><Page /></AdminFrame>, { user: null });

    await screen.findByText("Sign in to the console");
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
  });
});
