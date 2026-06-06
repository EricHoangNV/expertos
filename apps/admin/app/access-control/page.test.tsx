// Admin access-control (whitelist) tests (M15.2.5) — the `app/access-control/page.tsx` editor (M14).
// Covers the whitelist table render + empty state, the add-to-whitelist form (POST + validation),
// the role toggle (PATCH), the remove flow (DELETE behind a confirm), the self-lockout guard
// (server rejection surfaced as an error badge), and the load-error path. Renders through the real
// Auth + Locale providers (M15.2.1 harness), so the `POST /me/admin-session` admin-role resolution
// runs and the whitelist fetches go through the client.
//
// Note on settling (LEARNINGS #19): the page re-loads the list several times on mount (the harness
// sets the mock `currentUser` before render, so the first load already has a token; the admin-session
// role resolution fires another). `settle()` waits for that fan-out to go quiet before interacting
// with a row, so a row isn't transiently unmounted mid-click.
import {
  renderWithProviders,
  screen,
  waitFor,
  within,
  fireEvent,
  mockApi,
  apiCalls,
} from "../../test/render";
import type { AllowedEmailDto } from "@expertos/shared";
import AccessControlPage from "./page";

function entry(over: Partial<AllowedEmailDto> = {}): AllowedEmailDto {
  return {
    id: "ae_1",
    email: "expert@example.com",
    role: "expert",
    createdAt: "2026-05-30T12:00:00.000Z",
    createdByEmail: "owner@example.com",
    ...over,
  };
}

const LIST = "/admin/access-control";

/** Count of whitelist loads issued so far. */
function listGets(): number {
  return apiCalls().filter((c) => c.method === "GET" && c.pathname === LIST).length;
}

/** Wait until the list has rendered AND no further re-load has fired for two consecutive polls. */
async function settle(anchorEmail: string): Promise<void> {
  let prev = -1;
  let stable = 0;
  await waitFor(() => {
    expect(screen.queryByText(anchorEmail)).not.toBeNull();
    const n = listGets();
    stable = n === prev ? stable + 1 : 0;
    prev = n;
    expect(stable).toBeGreaterThanOrEqual(2);
  });
}

/** The `<tr>` for a whitelisted email. */
function rowFor(email: string): HTMLElement {
  return screen.getByText(email).closest("tr") as HTMLElement;
}

describe("AccessControlPage — table", () => {
  it("renders the whitelist with email, role badge, adder, and timestamp", async () => {
    mockApi("GET", LIST, {
      body: [entry({ id: "ae_a", email: "ada@example.com", role: "admin" })],
    });
    renderWithProviders(<AccessControlPage />, { role: "admin" });

    await waitFor(() => {
      const row = rowFor("ada@example.com");
      // Role renders as the localized label ("Admin"), not the raw enum token.
      expect(within(row).getByText("Admin")).toBeInTheDocument();
      expect(within(row).getByText("owner@example.com")).toBeInTheDocument();
      // An admin row offers the demote action; an expert row offers promote.
      expect(within(row).getByRole("button", { name: "Make expert" })).toBeInTheDocument();
    });
  });

  it("shows the empty state when no email is whitelisted", async () => {
    mockApi("GET", LIST, { body: [] });
    renderWithProviders(<AccessControlPage />, { role: "admin" });

    await screen.findByText("No emails are whitelisted yet.");
  });

  it("frames the add form in a card and bolds the grantable roles in the intro (screenshot 22)", async () => {
    mockApi("GET", LIST, { body: [] });
    const { container } = renderWithProviders(<AccessControlPage />, { role: "admin" });
    await screen.findByText("No emails are whitelisted yet.");

    // The intro emphasizes both grantable roles in <strong> (no separate copy key).
    const emphasized = Array.from(container.querySelectorAll("p.muted strong")).map(
      (n) => n.textContent,
    );
    expect(emphasized).toEqual(expect.arrayContaining(["Admin", "Expert"]));

    // The add-to-whitelist form sits inside a bordered `.card .card-pad` panel.
    expect(screen.getByRole("button", { name: "Add" }).closest(".card.card-pad")).not.toBeNull();
  });
});

describe("AccessControlPage — add", () => {
  it("posts a new whitelist entry and shows the added notice", async () => {
    mockApi("GET", LIST, { body: [] });
    mockApi("POST", LIST, { body: entry({ email: "new@example.com" }) });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await screen.findByText("No emails are whitelisted yet.");

    fireEvent.change(screen.getByPlaceholderText("person@example.com"), {
      target: { value: "New@Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = apiCalls().find((c) => c.method === "POST" && c.pathname === LIST);
      expect(post).toBeDefined();
      // The default role in the form is expert; the page trims the email (lowercasing is server-side).
      expect(post!.body).toEqual({ email: "New@Example.com", role: "expert" });
    });
    // Notice uses the lowercased email the page derives for display.
    await screen.findByText("Added new@example.com.");
  });

  it("rejects a blank email client-side without posting", async () => {
    mockApi("GET", LIST, { body: [] });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await screen.findByText("No emails are whitelisted yet.");

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await screen.findByText("Enter an email to add.");
    // No POST to the whitelist endpoint (the admin-session POST is unrelated).
    expect(apiCalls().some((c) => c.method === "POST" && c.pathname === LIST)).toBe(false);
  });
});

describe("AccessControlPage — role toggle + remove", () => {
  it("promotes an expert to admin via PATCH", async () => {
    mockApi("GET", LIST, { body: [entry({ id: "ae_e", email: "ed@example.com", role: "expert" })] });
    mockApi("PATCH", "/admin/access-control/ae_e", {
      body: entry({ id: "ae_e", email: "ed@example.com", role: "admin" }),
    });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await settle("ed@example.com");

    fireEvent.click(within(rowFor("ed@example.com")).getByRole("button", { name: "Make admin" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/admin/access-control/ae_e",
      );
      expect(patch).toBeDefined();
      expect(patch!.body).toEqual({ role: "admin" });
    });
    await screen.findByText("ed@example.com is now Admin.");
  });

  it("removes an entry via DELETE when the removal is confirmed", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockApi("GET", LIST, { body: [entry({ id: "ae_e", email: "ed@example.com" })] });
    mockApi("DELETE", "/admin/access-control/ae_e", { body: { ok: true } });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await settle("ed@example.com");

    fireEvent.click(within(rowFor("ed@example.com")).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(
        apiCalls().some((c) => c.method === "DELETE" && c.pathname === "/admin/access-control/ae_e"),
      ).toBe(true),
    );
    await screen.findByText("Removed ed@example.com.");
    confirmSpy.mockRestore();
  });

  it("does not DELETE when the removal is cancelled", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    mockApi("GET", LIST, { body: [entry({ id: "ae_e", email: "ed@example.com" })] });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await settle("ed@example.com");

    fireEvent.click(within(rowFor("ed@example.com")).getByRole("button", { name: "Remove" }));

    // Give any (mistaken) request a chance to fire, then assert none did.
    await Promise.resolve();
    expect(apiCalls().some((c) => c.method === "DELETE")).toBe(false);
    confirmSpy.mockRestore();
  });

  it("surfaces the server self-lockout rejection as an error badge", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    mockApi("GET", LIST, { body: [entry({ id: "ae_self", email: "me@example.com", role: "admin" })] });
    // The API forbids removing your own whitelist entry (self-lockout protection).
    mockApi("DELETE", "/admin/access-control/ae_self", {
      status: 400,
      body: { message: "You cannot remove your own access." },
    });
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await settle("me@example.com");

    fireEvent.click(within(rowFor("me@example.com")).getByRole("button", { name: "Remove" }));

    await screen.findByText("You cannot remove your own access.");
    confirmSpy.mockRestore();
  });
});

describe("AccessControlPage — error state", () => {
  it("surfaces a load error when the whitelist fetch fails", async () => {
    // Leave GET unmocked → 404 → the page renders the error badge.
    renderWithProviders(<AccessControlPage />, { role: "admin" });
    await screen.findByText("Request failed (404)");
  });
});
