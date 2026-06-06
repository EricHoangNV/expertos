// Admin user-management tests (M15.2.5) — the `app/users/page.tsx` list (M8.4) and the
// `app/users/[id]/page.tsx` detail page (role change + data-deletion request/execute, M8.4 + §4.8).
// Renders through the real Auth + Locale providers (M15.2.1 harness), so the `POST /me/admin-session`
// admin-role resolution runs and the user fetches go through the client.
//
// Note on settling (LEARNINGS #19): each page re-loads several times on mount (the harness sets the
// mock `currentUser` before render, so the first load already has a token; the admin-session role
// resolution fires another). `settle()` waits for that fan-out to go quiet before interacting.
import {
  renderWithProviders,
  screen,
  waitFor,
  within,
  fireEvent,
  mockApi,
  apiCalls,
  getMockRouter,
  setMockParams,
} from "../../test/render";
import type { AdminUserDetailDto, AdminUserSummaryDto } from "@expertos/shared";
import UsersPage from "./page";
import UserDetailPage from "./[id]/page";

function summary(over: Partial<AdminUserSummaryDto> = {}): AdminUserSummaryDto {
  return {
    id: "u_1",
    email: "jane@example.com",
    displayName: "Jane User",
    role: "user",
    planKey: null,
    subscriptionStatus: null,
    createdAt: "2026-04-01T12:00:00.000Z",
    ...over,
  };
}

function detail(over: Partial<AdminUserDetailDto> = {}): AdminUserDetailDto {
  return {
    id: "u_1",
    email: "jane@example.com",
    displayName: "Jane User",
    role: "user",
    locale: "en",
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    subscription: null,
    activity: { conversationCount: 3, uploadCount: 1, consultationCount: 0 },
    fairUseFlags: [],
    deletion: null,
    ...over,
  };
}

/** Wait until `pathname`'s GET count is stable across two consecutive polls and `anchor` rendered. */
async function settle(pathname: string, anchor: string): Promise<void> {
  let prev = -1;
  let stable = 0;
  await waitFor(() => {
    expect(screen.queryByText(anchor)).not.toBeNull();
    const n = apiCalls().filter((c) => c.method === "GET" && c.pathname === pathname).length;
    stable = n === prev ? stable + 1 : 0;
    prev = n;
    expect(stable).toBeGreaterThanOrEqual(2);
  });
}

describe("UsersPage — list", () => {
  it("renders a row per user with role badge + plan fallback", async () => {
    mockApi("GET", "/admin/users", {
      body: [summary({ id: "u_a", email: "ada@example.com", role: "expert" })],
    });
    renderWithProviders(<UsersPage />, { role: "admin" });

    await waitFor(() => {
      const row = screen.getByText("ada@example.com").closest("tr") as HTMLElement;
      expect(within(row).getByText("expert")).toBeInTheDocument();
      // No subscription → the "free" plan fallback.
      expect(within(row).getByText("free")).toBeInTheDocument();
      expect(within(row).getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/users/u_a");
    });
  });

  it("renders the premium plan as a colored badge", async () => {
    mockApi("GET", "/admin/users", {
      body: [summary({ id: "u_p", email: "pro@example.com", planKey: "premium", subscriptionStatus: "active" })],
    });
    renderWithProviders(<UsersPage />, { role: "admin" });

    await waitFor(() => {
      const row = screen.getByText("pro@example.com").closest("tr") as HTMLElement;
      const badge = within(row).getByText("premium");
      expect(badge.className).toContain("badge");
    });
  });

  it("shows the empty state when no users match", async () => {
    mockApi("GET", "/admin/users", { body: [] });
    renderWithProviders(<UsersPage />, { role: "admin" });

    await screen.findByText("No users match.");
  });
});

describe("UserDetailPage — render", () => {
  beforeEach(() => setMockParams({ id: "u_1" }));

  it("renders identity, role badge, and activity stats", async () => {
    mockApi("GET", "/admin/users/u_1", { body: detail() });
    renderWithProviders(<UserDetailPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "jane@example.com" })).toBeInTheDocument();
      // Activity stats from the detail payload.
      expect(screen.getByText("Conversations").closest(".stat")).toHaveTextContent("3");
      // No subscription → the managed-elsewhere note.
      expect(screen.getByText("No subscription — effectively on the Free plan.")).toBeInTheDocument();
    });

    // Back-to-users eyebrow link (M19.5.2).
    const back = screen.getByRole("link", { name: "← Back to users" });
    expect(back).toHaveAttribute("href", "/users");
  });
});

describe("UserDetailPage — role change", () => {
  beforeEach(() => setMockParams({ id: "u_1" }));

  it("PATCHes the new role and shows the updated notice", async () => {
    mockApi("GET", "/admin/users/u_1", { body: detail({ role: "user" }) });
    mockApi("PATCH", "/admin/users/u_1/role", { body: summary({ role: "expert" }) });
    renderWithProviders(<UserDetailPage />, { role: "admin" });
    await settle("/admin/users/u_1", "jane@example.com");

    // The role editor is the only combobox on a user with no fair-use flags.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "expert" } });
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/admin/users/u_1/role",
      );
      expect(patch).toBeDefined();
      expect(patch!.body).toEqual({ role: "expert" });
    });
    await screen.findByText("Role updated.");
  });

  it("keeps the save button disabled until the role changes", async () => {
    mockApi("GET", "/admin/users/u_1", { body: detail({ role: "user" }) });
    renderWithProviders(<UserDetailPage />, { role: "admin" });
    await settle("/admin/users/u_1", "jane@example.com");

    expect(screen.getByRole("button", { name: "Save role" })).toBeDisabled();
  });
});

describe("UserDetailPage — data deletion", () => {
  beforeEach(() => setMockParams({ id: "u_1" }));

  it("records a deletion request via POST", async () => {
    mockApi("GET", "/admin/users/u_1", { body: detail() });
    mockApi("POST", "/admin/users/u_1/deletion-request", {
      body: {
        id: "ddr_1",
        userId: "u_1",
        status: "requested",
        requestedAt: "2026-06-02T00:00:00.000Z",
        completedAt: null,
      },
    });
    renderWithProviders(<UserDetailPage />, { role: "admin" });
    await settle("/admin/users/u_1", "jane@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Record deletion request" }));

    await waitFor(() =>
      expect(
        apiCalls().some(
          (c) => c.method === "POST" && c.pathname === "/admin/users/u_1/deletion-request",
        ),
      ).toBe(true),
    );
    await screen.findByText("Deletion request recorded.");
  });

  it("executes the GDPR cascade after confirmation and routes back to the list", async () => {
    mockApi("GET", "/admin/users/u_1", { body: detail() });
    mockApi("DELETE", "/admin/users/u_1", { body: { userId: "u_1", deleted: true } });
    renderWithProviders(<UserDetailPage />, { role: "admin" });
    await settle("/admin/users/u_1", "jane@example.com");

    // The destructive action is two-step: reveal the confirm control, then confirm.
    fireEvent.click(screen.getByRole("button", { name: "Delete data…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(
        apiCalls().some((c) => c.method === "DELETE" && c.pathname === "/admin/users/u_1"),
      ).toBe(true),
    );
    await waitFor(() => expect(getMockRouter().push).toHaveBeenCalledWith("/users"));
  });
});

describe("UserDetailPage — error state", () => {
  beforeEach(() => setMockParams({ id: "u_1" }));

  it("surfaces a load error when the user fetch fails", async () => {
    // Leave GET unmocked → 404 → the page renders the error badge.
    renderWithProviders(<UserDetailPage />, { role: "admin" });
    await screen.findByText("Request failed (404)");
  });
});
