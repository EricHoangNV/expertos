// Concierge-settings radio-card tests (M19.3.1, screenshot 10). Covers the three selectable mode
// cards (Off / Mode A / Mode B), the static metadata badges, the OD#5-gated Mode B (disabled +
// awaiting badge until `silentReviewAllowed`), and the pagehead Save posting the config. Rendered
// through the M15.2.1 provider harness so the admin-session role resolution runs.
import {
  renderWithProviders,
  screen,
  fireEvent,
  apiCalls,
  mockApi,
} from "../../test/render";
import type { ReviewConfigDto } from "@expertos/shared";
import ConciergePage from "./page";

function config(over: Partial<ReviewConfigDto> = {}): ReviewConfigDto {
  return {
    enabled: true,
    triggerMode: "user_prompted",
    confidenceThreshold: 0.45,
    slaHours: 24,
    volumeCapPerDay: 50,
    silentReviewAllowed: false,
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("concierge settings — mode radio cards (M19.3.1)", () => {
  it("renders the three mode cards with metadata badges; the selected mode is active and Mode B is gated", async () => {
    mockApi("GET", "/admin/concierge-config", { body: config() });
    renderWithProviders(<ConciergePage />);

    // All three mode titles render as radio options.
    const modeA = await screen.findByRole("radio", { name: "Mode A · User-prompted" });
    const off = await screen.findByRole("radio", { name: "Off" });
    const modeB = await screen.findByRole("radio", { name: "Mode B · Auto-silent" });

    // The persisted mode (user_prompted) is the checked card and carries `is-active`.
    expect(modeA).toBeChecked();
    expect(off).not.toBeChecked();
    expect(modeA.closest(".verdict-card")).toHaveClass("is-active");

    // Static metadata badges per the screenshot.
    expect(screen.getByText("No trigger")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Awaiting OD#5 sign-off")).toBeInTheDocument();

    // Mode B is disabled until the OD#5 sign-off flips `silentReviewAllowed`.
    expect(modeB).toBeDisabled();
  });

  it("enables Mode B and drops the awaiting badge once the OD#5 sign-off is granted", async () => {
    mockApi("GET", "/admin/concierge-config", {
      body: config({ silentReviewAllowed: true }),
    });
    renderWithProviders(<ConciergePage />);

    const modeB = await screen.findByRole("radio", { name: "Mode B · Auto-silent" });
    expect(modeB).not.toBeDisabled();
    expect(screen.queryByText("Awaiting OD#5 sign-off")).not.toBeInTheDocument();
  });

  it("posts the config from the pagehead Save action", async () => {
    mockApi("GET", "/admin/concierge-config", { body: config() });
    mockApi("PATCH", "/admin/concierge-config", {
      body: config({ enabled: false }),
    });
    renderWithProviders(<ConciergePage />);

    // Switch to Off, then Save.
    const off = await screen.findByRole("radio", { name: "Off" });
    fireEvent.click(off);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Wait for the save round-trip to settle before inspecting the recorded call.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const patch = apiCalls().find(
      (c) => c.method === "PATCH" && c.pathname === "/admin/concierge-config",
    );
    expect(patch).toBeDefined();
    expect(patch?.body).toMatchObject({ enabled: false });
  });
});
