// Admin usage-analytics page tests (M19.4.1) — the reference recipe page: pagehead + 5-Stat row +
// byFeature/byModel/byDay tables with the right-aligned cost column the parity pass added. Renders
// through the real Auth + Locale providers (M15.2.1 harness) so the `/admin/analytics/usage` read runs.
import { mockApi, renderWithProviders, screen, waitFor, within } from "../../test/render";
import type { UsageAnalyticsDto } from "@expertos/shared";
import AnalyticsPage from "./page";

function report(over: Partial<UsageAnalyticsDto> = {}): UsageAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-07T00:00:00.000Z",
    totalEvents: 31_204,
    promptTokens: 48_200_000,
    completionTokens: 12_700_000,
    totalCostMicros: 600_000_000, // $6.00
    activeUsers: 1_047,
    byFeature: [
      { featureKey: "chat.answer", events: 24_910, promptTokens: 39_100_000, completionTokens: 10_200_000, costMicros: 48_610_000_000 },
    ],
    byModel: [
      { model: "gpt-4o-mini", events: 24_910, promptTokens: 39_100_000, completionTokens: 10_200_000, costMicros: 48_610_000_000 },
    ],
    periods: [
      { period: "2026-06-05", events: 1_200, costMicros: 1_000_000_000, activeUsers: 80 },
    ],
    ...over,
  };
}

describe("AnalyticsPage", () => {
  it("renders the KPI stat row and the three breakdown tables", async () => {
    mockApi("GET", "/admin/analytics/usage", { body: report() });
    renderWithProviders(<AnalyticsPage />, { role: "admin" });

    // Settle on a late section first, then re-query each assertion with `findByText` — the mount-time
    // reload fan-out (LEARNINGS #19) detaches any node captured across the await boundary.
    await screen.findByText("By day");
    expect(await screen.findByText("AI events · 30d")).toBeInTheDocument();
    expect(await screen.findByText("Active users · 30d")).toBeInTheDocument();
    expect(await screen.findByText("By feature")).toBeInTheDocument();
    expect(await screen.findByText("By model")).toBeInTheDocument();
    expect(await screen.findByText("chat.answer")).toBeInTheDocument();
    expect(await screen.findByText("gpt-4o-mini")).toBeInTheDocument();
  });

  it("right-aligns the cost column header and cells", async () => {
    mockApi("GET", "/admin/analytics/usage", { body: report() });
    renderWithProviders(<AnalyticsPage />, { role: "admin" });

    // Settle on a late section, then re-query inside `waitFor` so the point-in-time `getAllBy*`
    // queries retry across the mount-time reload fan-out (LEARNINGS #19) rather than racing it.
    await screen.findByText("By day");
    await waitFor(() => {
      // The cost column (header + currency value) carries the `.num` right-align class in every table.
      const costHeaders = screen.getAllByRole("columnheader", { name: "Cost" });
      expect(costHeaders).toHaveLength(3);
      for (const th of costHeaders) {
        expect(th).toHaveClass("num");
      }
      // The byFeature/byModel cost cell renders the formatted USD amount with the right-align class.
      const costCells = screen.getAllByText("$486.10");
      expect(costCells.length).toBeGreaterThanOrEqual(2);
      for (const td of costCells) {
        expect(td).toHaveClass("num");
      }
    });
  });

  it("shows an empty-state note when a breakdown has no rows", async () => {
    mockApi("GET", "/admin/analytics/usage", { body: report({ byFeature: [], byModel: [], periods: [] }) });
    renderWithProviders(<AnalyticsPage />, { role: "admin" });

    const notes = await screen.findAllByText("No usage in this window.");
    expect(notes.length).toBe(3);
  });

  it("surfaces a load error when the usage fetch fails", async () => {
    // Leave the GET unmocked → 404 → the page renders the error badge.
    renderWithProviders(<AnalyticsPage />, { role: "admin" });
    await waitFor(() => expect(screen.getByText(/Request failed \(404\)/)).toBeInTheDocument());
  });
});
