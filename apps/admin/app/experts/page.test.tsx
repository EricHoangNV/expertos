// Experts list page tests (M19.2.4 design-parity). Covers the `.pagehead` right-aligned "New expert"
// trigger (which opens the create form), the `.lede` intro, and the roster `Table`: the leading
// `.avatar` cell before each name, the active/inactive status badge, and the "Manage" action rendered
// as a button-styled link. Renders through the real Auth + Locale providers (M15.2.1 harness).
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  mockApi,
} from "../../test/render";
import type { AdminExpertSummaryDto } from "@expertos/shared";
import ExpertsPage from "./page";

function expert(over: Partial<AdminExpertSummaryDto> = {}): AdminExpertSummaryDto {
  return {
    id: "e_1",
    slug: "ngo-cong-truong",
    displayName: "Ngô Công Trường",
    title: "Founder · Franchise & Unit Economics",
    active: true,
    voiceProfileCount: 2,
    createdAt: "2026-05-30T12:00:00.000Z",
    ...over,
  };
}

describe("ExpertsPage — pagehead", () => {
  it("renders the eyebrow, title, lede intro and a New-expert trigger that opens the form", async () => {
    mockApi("GET", "/admin/experts", { body: [expert()] });
    const { container } = renderWithProviders(<ExpertsPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Experts" })).toBeInTheDocument();
    });
    expect(container.querySelector(".pagehead .lede")).toBeInTheDocument();

    // The create form is closed until the pagehead button is clicked.
    expect(screen.queryByText("Slug (lowercase, hyphens)")).not.toBeInTheDocument();
    const trigger = container.querySelector<HTMLButtonElement>(".pagehead .btn-primary");
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    expect(screen.getByText("Slug (lowercase, hyphens)")).toBeInTheDocument();
  });
});

describe("ExpertsPage — roster table", () => {
  it("renders a leading avatar before the name, the status badge, and a Manage link-button", async () => {
    mockApi("GET", "/admin/experts", {
      body: [expert(), expert({ id: "e_2", slug: "anh-nguyen", displayName: "Anh Nguyễn", active: false })],
    });
    const { container } = renderWithProviders(<ExpertsPage />, { role: "admin" });

    await waitFor(() => expect(screen.getByText("Ngô Công Trường")).toBeInTheDocument());

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    // First (name) cell carries a sized, tone-colored avatar with the expert's initials.
    const avatar = rows[0].querySelector("td .avatar.avatar-sm");
    expect(avatar).not.toBeNull();
    expect(avatar?.className).toMatch(/tone-/);
    // Active vs inactive badge tone.
    expect(rows[0].querySelector(".badge-green")?.textContent).toBe("active");
    expect(rows[1].querySelector(".badge-ink")?.textContent).toBe("inactive");
    // Manage renders as a button-styled link to the detail route.
    const manage = rows[0].querySelector<HTMLAnchorElement>("a.btn");
    expect(manage).not.toBeNull();
    expect(manage).toHaveAttribute("href", "/experts/e_1");
  });
});

describe("ExpertsPage — error state", () => {
  it("surfaces a load error when the experts endpoint fails", async () => {
    // Leave the endpoint unmocked → the fetch 404s → the page shows the error badge.
    renderWithProviders(<ExpertsPage />, { role: "admin" });
    await screen.findByText("Request failed (404)");
  });
});
