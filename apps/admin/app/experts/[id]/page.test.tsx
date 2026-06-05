// Per-expert calendar / booking settings card tests (M16.5) — the `CalendarEditor` on the expert
// detail page. Covers the role-aware data source (admin → `/admin/experts/:id/calendar`, expert →
// `/expert/calendar-settings`), the write-only token model (configured ✓ ••••last4 indicator, blank
// save omits the token, clear sends `apiToken: null`), and the booking-link save. Renders through the
// real Auth + Locale providers (M15.2.1 harness), so the admin-session role resolution runs.
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  mockApi,
  apiCalls,
  setMockParams,
} from "../../../test/render";
import type { AdminExpertDetailDto, ExpertCalendarSettingsDto } from "@expertos/shared";
import ExpertDetailPage from "./page";

const EXPERT_ID = "exp_1";

function expert(over: Partial<AdminExpertDetailDto> = {}): AdminExpertDetailDto {
  return {
    id: EXPERT_ID,
    slug: "dr-lan",
    displayName: "Dr. Lan",
    title: "Cardiologist",
    bio: null,
    active: true,
    userId: null,
    linkedUserEmail: null,
    voiceProfileCount: 0,
    documentCount: 0,
    ...over,
  } as AdminExpertDetailDto;
}

function settings(over: Partial<ExpertCalendarSettingsDto> = {}): ExpertCalendarSettingsDto {
  return { apiTokenConfigured: false, apiTokenLast4: null, tidycalLink: null, ...over };
}

beforeEach(() => {
  setMockParams({ id: EXPERT_ID });
  mockApi("GET", `/admin/experts/${EXPERT_ID}`, { body: expert() });
});

describe("CalendarEditor — data source", () => {
  it("reads via the admin endpoint for an admin", async () => {
    mockApi("GET", `/admin/experts/${EXPERT_ID}/calendar`, {
      body: settings({ apiTokenConfigured: true, apiTokenLast4: "1234" }),
    });
    renderWithProviders(<ExpertDetailPage />, { role: "admin" });

    await screen.findByText("Configured ✓ ••••1234");
    expect(
      apiCalls().some((c) => c.pathname === `/admin/experts/${EXPERT_ID}/calendar` && c.method === "GET"),
    ).toBe(true);
    expect(apiCalls().some((c) => c.pathname === "/expert/calendar-settings")).toBe(false);
  });

  it("reads via the self-service endpoint for a non-admin expert", async () => {
    mockApi("GET", "/expert/calendar-settings", { body: settings() });
    renderWithProviders(<ExpertDetailPage />, { role: "expert" });

    await screen.findByText("No API token configured yet.");
    expect(apiCalls().some((c) => c.pathname === "/expert/calendar-settings" && c.method === "GET")).toBe(true);
  });
});

describe("CalendarEditor — save", () => {
  it("omits the token when blank but sends the booking link (admin)", async () => {
    mockApi("GET", `/admin/experts/${EXPERT_ID}/calendar`, { body: settings() });
    mockApi("PATCH", `/admin/experts/${EXPERT_ID}/calendar`, {
      body: settings({ tidycalLink: "https://tidycal.com/dr-lan" }),
    });
    renderWithProviders(<ExpertDetailPage />, { role: "admin" });

    const link = await screen.findByPlaceholderText("https://tidycal.com/your-name");
    fireEvent.change(link, { target: { value: "https://tidycal.com/dr-lan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calendar settings" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === `/admin/experts/${EXPERT_ID}/calendar`,
      );
      expect(patch?.body).toEqual({ tidycalLink: "https://tidycal.com/dr-lan" });
    });
    await screen.findByText("Calendar settings saved.");
  });

  it("sends a non-empty token when one is entered (expert)", async () => {
    mockApi("GET", "/expert/calendar-settings", { body: settings() });
    mockApi("PATCH", "/expert/calendar-settings", {
      body: settings({ apiTokenConfigured: true, apiTokenLast4: "cdef" }),
    });
    renderWithProviders(<ExpertDetailPage />, { role: "expert" });

    const tokenInput = await screen.findByPlaceholderText("Paste a token to set or replace it");
    fireEvent.change(tokenInput, { target: { value: "secret-abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calendar settings" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === "/expert/calendar-settings",
      );
      expect(patch?.body).toEqual({ apiToken: "secret-abcdef", tidycalLink: null });
    });
    // The input resets and the configured indicator appears.
    await screen.findByText("Configured ✓ ••••cdef");
  });

  it("clears the token via apiToken: null", async () => {
    mockApi("GET", `/admin/experts/${EXPERT_ID}/calendar`, {
      body: settings({ apiTokenConfigured: true, apiTokenLast4: "1234" }),
    });
    mockApi("PATCH", `/admin/experts/${EXPERT_ID}/calendar`, { body: settings() });
    renderWithProviders(<ExpertDetailPage />, { role: "admin" });

    fireEvent.click(await screen.findByRole("button", { name: "Clear token" }));

    await waitFor(() => {
      const patch = apiCalls().find(
        (c) => c.method === "PATCH" && c.pathname === `/admin/experts/${EXPERT_ID}/calendar`,
      );
      expect(patch?.body).toEqual({ apiToken: null });
    });
    await screen.findByText("API token cleared.");
  });
});
