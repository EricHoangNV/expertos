// Admin consultation-funnel page tests (M19.4.2) — the stage-attribution card the parity pass added
// on top of the existing KPI Stat row + byTrigger/byResponse/byStatus breakdowns. Renders through the
// real Auth + Locale providers (M15.2.1 harness) so the page's `/admin/analytics/funnel` read runs.
import { mockApi, renderWithProviders, screen, waitFor, within } from "../../test/render";
import type { FunnelAnalyticsDto } from "@expertos/shared";
import FunnelPage from "./page";

function report(over: Partial<FunnelAnalyticsDto> = {}): FunnelAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-07T00:00:00.000Z",
    conversations: 8420,
    recommendations: 412,
    byTrigger: { topic: 200, depth: 100, low_confidence: 80, high_intent: 32 },
    byResponse: { book: 37, maybe_later: 120, ask_another: 90, pending: 165 },
    consultations: 41,
    byConsultationStatus: {
      recommended: 4,
      booked: 20,
      confirmed: 10,
      completed: 5,
      canceled: 1,
      no_show: 1,
    },
    bookedRevenueCents: 1_150_000,
    ...over,
  };
}

describe("FunnelPage — stage attribution", () => {
  it("renders a bar row per stage with the count and conversion vs. the previous stage", async () => {
    mockApi("GET", "/admin/analytics/funnel", { body: report() });
    renderWithProviders(<FunnelPage />, { role: "admin" });

    // The stage-attribution card centerpiece. `findByText` retries across the mount-time reload
    // fan-out (LEARNINGS #19), which detaches any node captured too early.
    await screen.findByText("Stage attribution");

    // Each downstream stage trails its count with the conversion vs. the previous stage; these
    // composed strings are unique to the stage card.
    const recRow = (await screen.findByText("412 · 4.9%")) // recs / conversations
      .closest(".funnel-card") as HTMLElement;
    expect(recRow).not.toBeNull();
    expect(within(recRow).getByText("37 · 9.0%")).toBeInTheDocument(); // booked / recs
    expect(within(recRow).getByText("41 · 110.8%")).toBeInTheDocument(); // consultations / booked

    // Conversations is the top of the funnel → count only. The KPI stat repeats "8,420", so both the
    // card row and the stat card carry it (two matches total).
    expect(within(recRow).getByText("8,420")).toBeInTheDocument();

    // Revenue is a value-only row (no bar inside its row head).
    const rev = within(recRow).getByText("Revenue").closest(".funnel-row-head") as HTMLElement;
    expect(within(rev).getByText("$11,500.00")).toBeInTheDocument();
    expect(rev.parentElement?.querySelector(".bar")).toBeNull();
  });

  it("keeps the KPI stat row and the trigger/response/status breakdowns", async () => {
    mockApi("GET", "/admin/analytics/funnel", { body: report() });
    renderWithProviders(<FunnelPage />, { role: "admin" });

    await screen.findByText("Stage attribution");
    // KPI stat row (the conversations stat card carries the windowed label). `findByText` retries
    // across the mount-time reload fan-out (LEARNINGS #19) rather than racing a synchronous read.
    expect(await screen.findByText("Conversations · 30d")).toBeInTheDocument();
    // Breakdown sections below the card.
    expect(await screen.findByText("Recommendations by trigger")).toBeInTheDocument();
    expect(await screen.findByText("Recommendations by response")).toBeInTheDocument();
    expect(await screen.findByText("Consultations by status")).toBeInTheDocument();
  });

  it("guards a divide-by-zero when there are no conversations", async () => {
    mockApi("GET", "/admin/analytics/funnel", {
      body: report({ conversations: 0, recommendations: 0, byResponse: { book: 0, maybe_later: 0, ask_another: 0, pending: 0 } }),
    });
    renderWithProviders(<FunnelPage />, { role: "admin" });

    // No base → the rate helper renders an em-dash rather than NaN% (recommendations + booked rows).
    const rows = await screen.findAllByText("0 · —");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("surfaces a load error when the funnel fetch fails", async () => {
    // Leave the GET unmocked → 404 → the page renders the error badge.
    renderWithProviders(<FunnelPage />, { role: "admin" });
    await waitFor(() => expect(screen.getByText(/Request failed \(404\)/)).toBeInTheDocument());
  });
});
