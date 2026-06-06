// Admin concierge-analytics page tests (M19.3.2) — the parity pass laid SLA-adherence and
// trigger-mode/visibility into two side-by-side `.matrix-foot` cards and added green answered-rate /
// sla-tracked deltas on the stat cards. Renders through the real Auth + Locale providers (M15.2.1
// harness) so the `/admin/analytics/concierge` read runs.
import { mockApi, renderWithProviders, screen, waitFor, within } from "../../test/render";
import type { ConciergeAnalyticsDto } from "@expertos/shared";
import ConciergeAnalyticsPage from "./page";

function report(over: Partial<ConciergeAnalyticsDto> = {}): ConciergeAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-07T00:00:00.000Z",
    totalRequests: 312,
    byStatus: { requested: 12, in_review: 8, answered: 287, escalated: 3, dismissed: 2 },
    byTriggerMode: { user_prompted: 271, auto_silent: 41 },
    byVisibility: { visible: 271, silent: 41 },
    sla: { tracked: 305, met: 287, breached: 10, openOverdue: 8, avgResponseMinutes: 18 },
    verdicts: {
      total: 287,
      byVerdict: { good: 180, bad: 27, great: 80 },
      edited: 95,
      delivered: 270,
    },
    knowledge: { flaggedChunks: 14, totalFlags: 31, recentlyFlagged: 6, topFlagged: [] },
    ...over,
  };
}

describe("ConciergeAnalyticsPage", () => {
  it("renders the KPI stat row with the green answered-rate and sla-tracked deltas", async () => {
    mockApi("GET", "/admin/analytics/concierge", { body: report() });
    const { container } = renderWithProviders(<ConciergeAnalyticsPage />, { role: "admin" });

    // Settle on a late section first, then re-query each assertion with `findBy*` — the mount-time
    // reload fan-out (LEARNINGS #19) detaches any node captured across the await boundary.
    await screen.findByText("Reviewer verdicts");

    // Answered-rate delta (287 / 312 = 92.0%) carries the green `.up` trend class.
    const answeredRate = await screen.findByText("92.0% answered");
    expect(answeredRate).toHaveClass("d", "up");
    // Exactly two stat cards carry a green `.d.up` delta: answered-rate and sla-tracked. Scope to
    // `.stat` since the SLA-adherence panel below renders the same "Tracked: 305" text as a badge.
    await waitFor(() => {
      const greenDeltas = Array.from(container.querySelectorAll(".stat .d.up")).map((n) => n.textContent);
      expect(greenDeltas).toEqual(["92.0% answered", "Tracked: 305"]);
    });
  });

  it("lays SLA-adherence and trigger-mode/visibility into two side-by-side titled cards", async () => {
    mockApi("GET", "/admin/analytics/concierge", { body: report() });
    const { container } = renderWithProviders(<ConciergeAnalyticsPage />, { role: "admin" });

    await screen.findByText("Reviewer verdicts");
    await waitFor(() => {
      // The two panels sit in the shared `.matrix-foot` 2-up grid as `.card` children.
      const grid = container.querySelector(".matrix-foot");
      expect(grid).not.toBeNull();
      const cards = grid!.querySelectorAll(".card");
      expect(cards).toHaveLength(2);
      // Each card is titled by an `.eyebrow` label.
      expect(within(cards[0] as HTMLElement).getByText("SLA adherence")).toHaveClass("eyebrow");
      expect(
        within(cards[1] as HTMLElement).getByText("By trigger mode & visibility"),
      ).toHaveClass("eyebrow");
      // The trigger-mode/visibility card carries both groups' badge chips.
      expect(within(cards[1] as HTMLElement).getByText("User-prompted (Mode A): 271")).toBeInTheDocument();
      expect(within(cards[1] as HTMLElement).getByText("silent: 41")).toBeInTheDocument();
    });
  });

  it("keeps the status / verdict / knowledge sections below the panels", async () => {
    mockApi("GET", "/admin/analytics/concierge", { body: report() });
    renderWithProviders(<ConciergeAnalyticsPage />, { role: "admin" });

    expect(await screen.findByText("Requests by status")).toBeInTheDocument();
    expect(await screen.findByText("Reviewer verdicts")).toBeInTheDocument();
    expect(await screen.findByText("Knowledge quality (cumulative)")).toBeInTheDocument();
  });

  it("surfaces a load error when the concierge fetch fails", async () => {
    // Leave the GET unmocked → 404 → the page renders the error badge.
    renderWithProviders(<ConciergeAnalyticsPage />, { role: "admin" });
    await waitFor(() => expect(screen.getByText(/Request failed \(404\)/)).toBeInTheDocument());
  });
});
