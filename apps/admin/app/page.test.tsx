// Admin dashboard tests (M15.2.3) — the console landing page (`app/page.tsx`). Covers the
// KPI stat cards (MRR + MoM delta, active subscribers, consult conversions, activation rate),
// the Questions-Answered grounding breakdown, the Consultation-Funnel proportional bars +
// summary, the Knowledge-Pipeline status badges, the Concierge SLA dark card, and the
// Low-Confidence query preview (rows + empty state) — plus the 7d/30d/QTD range control and
// the load-error path. Renders through the real Auth + Locale providers (M15.2.1 harness),
// so the `POST /me/admin-session` admin-role resolution + the seven analytics fetches run for real.
//
// Note on `waitFor`: the page double-loads on mount — the auth context recreates `getIdToken`
// when the admin-session resolves the role, which re-fires the dashboard's `load` (a transient
// `setData(null)` between the two fetches). Assertions are therefore wrapped in `waitFor` so they
// retry past that brief reload window and assert the settled state.
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  mockApi,
  apiCalls,
} from "../test/render";
import type {
  ConciergeAnalyticsDto,
  FailedQueryDto,
  FunnelAnalyticsDto,
  KnowledgePipelineDto,
  QuestionsAnalyticsDto,
  RevenueReportDto,
  ValidationAnalyticsDto,
} from "@expertos/shared";
import AdminHomePage from "./page";

// ── Mock DTO factories ───────────────────────────────────────────────────────
// Each returns a full-shaped DTO with sensible defaults the tests override per-case. The
// fetch mock serves these as JSON, so the page's real client + render code runs unchanged.

function revenue(over: Partial<RevenueReportDto> = {}): RevenueReportDto {
  return {
    windowMonths: 3,
    since: "2026-03-01T00:00:00.000Z",
    mrrCents: 1_599_900,
    activeSubscriptions: 124,
    grossCents: 4_800_000,
    refundedCents: 0,
    netCents: 4_800_000,
    aiCostMicros: 0,
    marginCents: 4_800_000,
    byPlan: [
      { planKey: "premium", planName: "Premium", activeSubscriptions: 50, mrrCents: 999_900 },
      { planKey: "plus", planName: "Plus", activeSubscriptions: 74, mrrCents: 600_000 },
    ],
    periods: [
      { period: "2026-04", grossCents: 0, refundedCents: 0, netCents: 100_000, transactionCount: 10 },
      { period: "2026-05", grossCents: 0, refundedCents: 0, netCents: 120_000, transactionCount: 12 },
    ],
    ...over,
  };
}

function funnel(over: Partial<FunnelAnalyticsDto> = {}): FunnelAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-03T00:00:00.000Z",
    conversations: 200,
    recommendations: 50,
    byTrigger: { topic: 50, depth: 0, low_confidence: 0, high_intent: 0 } as FunnelAnalyticsDto["byTrigger"],
    byResponse: { pending: 30, book: 10, maybe_later: 5, ask_another: 5 } as FunnelAnalyticsDto["byResponse"],
    consultations: 10,
    byConsultationStatus: {
      recommended: 0,
      booked: 10,
      confirmed: 0,
      completed: 0,
      canceled: 0,
      no_show: 0,
    } as FunnelAnalyticsDto["byConsultationStatus"],
    bookedRevenueCents: 500_000,
    ...over,
  };
}

function validation(over: Partial<ValidationAnalyticsDto> = {}): ValidationAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-03T00:00:00.000Z",
    activation: { newUsers: 80, activatedUsers: 60, activationRate: 0.75 },
    engagement: {
      activeUsers: 40,
      totalQuestions: 320,
      medianQuestionsPerActiveUser: 6,
      returnedUsers: 24,
      returnRate: 0.3,
    },
    willingnessToPay: { totalUsers: 200, payingUsers: 30, trialingUsers: 5, freeToPaidRate: 0.15 },
    funnel: {
      recommendations: 50,
      bookings: 10,
      recommendationToBookingRate: 0.2,
      bookedRevenueCents: 500_000,
      bookingUsers: 10,
      revenuePerBookingUserCents: 50_000,
    },
    ...over,
  };
}

function questions(over: Partial<QuestionsAnalyticsDto> = {}): QuestionsAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-03T00:00:00.000Z",
    total: 100,
    breakdown: { grounded: 70, lowConfidence: 20, insufficient: 10 },
    periods: [
      { period: "2026-05-30", grounded: 7, lowConfidence: 2, insufficient: 1 },
      { period: "2026-05-31", grounded: 9, lowConfidence: 1, insufficient: 0 },
    ],
    ...over,
  };
}

function pipeline(over: Partial<KnowledgePipelineDto> = {}): KnowledgePipelineDto {
  return {
    byStatus: { draft: 3, ai_processing: 1, expert_review: 5, published: 42, archived: 8 },
    total: 59,
    ...over,
  };
}

function concierge(over: Partial<ConciergeAnalyticsDto> = {}): ConciergeAnalyticsDto {
  return {
    windowDays: 30,
    since: "2026-05-03T00:00:00.000Z",
    totalRequests: 18,
    byStatus: {
      requested: 2,
      in_review: 1,
      answered: 12,
      escalated: 2,
      dismissed: 1,
    } as ConciergeAnalyticsDto["byStatus"],
    byTriggerMode: { user_prompted: 4, auto_silent: 14 } as ConciergeAnalyticsDto["byTriggerMode"],
    byVisibility: { visible: 4, silent: 14 } as ConciergeAnalyticsDto["byVisibility"],
    sla: { tracked: 18, met: 16, breached: 2, openOverdue: 0, avgResponseMinutes: 1264 },
    verdicts: {
      total: 12,
      byVerdict: { good: 6, bad: 2, great: 4 } as ConciergeAnalyticsDto["verdicts"]["byVerdict"],
      edited: 5,
      delivered: 5,
    },
    knowledge: { flaggedChunks: 2, totalFlags: 3, recentlyFlagged: 1, topFlagged: [] },
    ...over,
  };
}

function failedQuery(over: Partial<FailedQueryDto> = {}): FailedQueryDto {
  return {
    feedbackId: "fb_1",
    messageId: "m_1",
    conversationId: "c_1",
    question: "How do I file my quarterly taxes?",
    answer: "You should consult a professional.",
    reason: "Too vague",
    model: "claude-opus-4-8",
    confidence: 0.45,
    insufficientKnowledge: true,
    createdAt: "2026-05-31T12:00:00.000Z",
    ...over,
  };
}

/** Register all seven dashboard endpoints with the given (or default) bodies. */
function mockDashboard(over: {
  revenue?: RevenueReportDto;
  funnel?: FunnelAnalyticsDto;
  validation?: ValidationAnalyticsDto;
  questions?: QuestionsAnalyticsDto;
  pipeline?: KnowledgePipelineDto;
  failedQueries?: FailedQueryDto[];
  concierge?: ConciergeAnalyticsDto;
} = {}): void {
  mockApi("GET", "/admin/revenue/report", { body: over.revenue ?? revenue() });
  mockApi("GET", "/admin/analytics/funnel", { body: over.funnel ?? funnel() });
  mockApi("GET", "/admin/analytics/validation", { body: over.validation ?? validation() });
  mockApi("GET", "/admin/analytics/questions", { body: over.questions ?? questions() });
  mockApi("GET", "/admin/analytics/knowledge-pipeline", { body: over.pipeline ?? pipeline() });
  mockApi("GET", "/admin/failed-queries", { body: over.failedQueries ?? [failedQuery()] });
  mockApi("GET", "/admin/analytics/concierge", { body: over.concierge ?? concierge() });
}

describe("AdminHomePage — KPI cards", () => {
  it("renders the four KPI stats with values + MoM delta", async () => {
    mockDashboard();
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      // MRR card: $15,999 (cents → whole dollars) with the +20% MoM delta (100k→120k net).
      expect(screen.getByText("MRR")).toBeInTheDocument();
      expect(screen.getByText("$15,999")).toBeInTheDocument();
      const mrrDelta = screen.getByText("+20.0% vs last mo");
      expect(mrrDelta.className).toContain("up"); // positive trend tints the delta green
      // Active subscribers: 124, "2 live plans".
      expect(screen.getByText("124")).toBeInTheDocument();
      expect(screen.getByText("2 live plans")).toBeInTheDocument();
      // Consult conversions: "$5,000 booked".
      expect(screen.getByText("$5,000 booked")).toBeInTheDocument();
      // Activation rate: 0.75 → "75.0%", "60 of 80 new users cited".
      expect(screen.getByText("75.0%")).toBeInTheDocument();
      expect(screen.getByText("60 of 80 new users cited")).toBeInTheDocument();
      expect(container.querySelectorAll(".kpi-grid .stat")).toHaveLength(4);
    });
  });

  it("renders a down-trend delta when MRR fell month-over-month", async () => {
    mockDashboard({
      revenue: revenue({
        periods: [
          { period: "2026-04", grossCents: 0, refundedCents: 0, netCents: 200_000, transactionCount: 20 },
          { period: "2026-05", grossCents: 0, refundedCents: 0, netCents: 150_000, transactionCount: 15 },
        ],
      }),
    });
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const delta = screen.getByText("-25.0% vs last mo");
      expect(delta.className).toContain("down");
    });
  });

  it("omits the MRR delta when there is only one revenue period", async () => {
    mockDashboard({
      revenue: revenue({
        periods: [
          { period: "2026-05", grossCents: 0, refundedCents: 0, netCents: 120_000, transactionCount: 12 },
        ],
      }),
    });
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => expect(screen.getByText("$15,999")).toBeInTheDocument());
    expect(screen.queryByText(/vs last mo/)).not.toBeInTheDocument();
  });
});

describe("AdminHomePage — Questions Answered card", () => {
  it("renders the total + grounding breakdown badges", async () => {
    mockDashboard();
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("Questions answered")).toBeInTheDocument();
      expect(screen.getByText("100")).toBeInTheDocument(); // total
      // share() rounds: 70/100=70%, 20/100=20%, 10/100=10%.
      expect(screen.getByText("Grounded 70%")).toBeInTheDocument();
      expect(screen.getByText("Low-conf 20%")).toBeInTheDocument();
      expect(screen.getByText("Insufficient 10%")).toBeInTheDocument();
    });
  });

  it("shows the empty-series note when no answers in the window", async () => {
    mockDashboard({
      questions: questions({ total: 0, breakdown: { grounded: 0, lowConfidence: 0, insufficient: 0 }, periods: [] }),
    });
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() =>
      expect(screen.getByText("No answers in this window yet.")).toBeInTheDocument(),
    );
  });

  it("renders one trend column per day in the window, zero-filling empty days", async () => {
    mockDashboard({
      questions: questions({
        windowDays: 7,
        since: "2026-05-27T00:00:00.000Z",
        total: 3,
        breakdown: { grounded: 2, lowConfidence: 0, insufficient: 1 },
        // Only one active day — the chart should still span all 7 days of the window.
        periods: [{ period: "2026-05-29", grounded: 2, lowConfidence: 0, insufficient: 1 }],
      }),
    });
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => expect(screen.getByText("Questions answered")).toBeInTheDocument());
    expect(container.querySelectorAll(".qa-chart .qa-col")).toHaveLength(7);
  });
});

describe("AdminHomePage — Consultation Funnel card", () => {
  it("renders proportional bar fills + the conversion summary", async () => {
    mockDashboard();
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    // Bars carry the rowAria accessible label; the inner <i> width is the proportional fill.
    const widthOf = (label: string): string =>
      (container.querySelector(`[aria-label="${label}"] i`) as HTMLElement | null)?.style.width ?? "";

    await waitFor(() => {
      expect(screen.getByText("Consultation funnel · attribution")).toBeInTheDocument();
      expect(widthOf("Questions: 200")).toBe("100%"); // funnel top
      expect(widthOf("Recommend: 50")).toBe("25%"); // 50/200
      expect(widthOf("Booked: 10")).toBe("5%"); // 10/200
      expect(widthOf("Revenue: $5,000")).toBe("5%"); // revenue tracks the booked width
      // 10/50 = 20.0% recommend→book; avg = 500,000c / 10 = 50,000c = $500.
      expect(
        screen.getByText("20.0% recommend→book. Each booking averages $500."),
      ).toBeInTheDocument();
    });
  });

  it("renders a 0% funnel and em-dash average when there are no conversations", async () => {
    mockDashboard({
      funnel: funnel({
        conversations: 0,
        recommendations: 0,
        byResponse: { pending: 0, book: 0, maybe_later: 0, ask_another: 0 } as FunnelAnalyticsDto["byResponse"],
        consultations: 0,
        bookedRevenueCents: 0,
      }),
    });
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const questionsBar = container.querySelector('[aria-label="Questions: 0"] i') as HTMLElement | null;
      // The top row is always 100% wide; the empty base shows "—" recommend→book.
      expect(questionsBar?.style.width).toBe("100%");
      expect(screen.getByText("— recommend→book. Each booking averages —.")).toBeInTheDocument();
    });
  });
});

describe("AdminHomePage — Knowledge Pipeline card", () => {
  it("renders a status badge + count per stage (archived omitted)", async () => {
    mockDashboard();
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const card = container.querySelector(".pipeline-card") as HTMLElement | null;
      expect(card).not.toBeNull();
      // Four stage rows: Draft(ink) 3, AI Processing(info) 1, Expert Review(amber) 5, Published(green) 42.
      // archived (8) is not part of the active pipeline.
      expect(card!.querySelectorAll(".pipeline-row")).toHaveLength(4);
      expect(card!.querySelector(".badge.badge-ink")?.textContent).toBe("Draft");
      expect(card!.querySelector(".badge.badge-info")?.textContent).toBe("AI Processing");
      expect(card!.querySelector(".badge.badge-amber")?.textContent).toBe("Expert Review");
      expect(card!.querySelector(".badge.badge-green")?.textContent).toBe("Published");
      const counts = Array.from(card!.querySelectorAll(".pipeline-count")).map((c) => c.textContent);
      expect(counts).toEqual(["3", "1", "5", "42"]);
      expect(screen.getByRole("link", { name: "Review queue →" })).toHaveAttribute("href", "/knowledge");
    });
  });
});

describe("AdminHomePage — Concierge SLA card", () => {
  it("renders the avg time-to-answer + open-queue badge on a dark card", async () => {
    mockDashboard();
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const card = container.querySelector(".sla-card") as HTMLElement | null;
      expect(card?.className).toContain("dark-card");
      // 1264 minutes → 21h 04m; open queue = requested(2) + in_review(1) = 3.
      expect(screen.getByText("21h 04m")).toBeInTheDocument();
      expect(screen.getByText("3 in queue")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open queue →" })).toHaveAttribute(
        "href",
        "/concierge-reviews",
      );
    });
  });

  it("shows an em-dash when no reviews have been answered yet", async () => {
    mockDashboard({
      concierge: concierge({ sla: { tracked: 0, met: 0, breached: 0, openOverdue: 0, avgResponseMinutes: null } }),
    });
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const time = container.querySelector(".sla-time") as HTMLElement | null;
      expect(time?.textContent).toBe("—");
    });
  });
});

describe("AdminHomePage — Low-Confidence Queries card", () => {
  it("renders flagged-query rows with confidence circle + insufficient badge", async () => {
    mockDashboard();
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("Drives the content roadmap")).toBeInTheDocument();
      expect(screen.getByText("How do I file my quarterly taxes?")).toBeInTheDocument();
      // confidence 0.45 → "45" in a red (conf-low) circle.
      const circle = screen.getByText("45");
      expect(circle.className).toContain("conf-low");
      expect(screen.getByText("Insufficient")).toBeInTheDocument(); // insufficientKnowledge badge
      expect(screen.getByText("Too vague")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Draft knowledge" })).toHaveAttribute(
        "href",
        "/knowledge-drafts",
      );
    });
  });

  it("renders an em-dash circle when a flagged answer has no confidence score", async () => {
    mockDashboard({
      failedQueries: [failedQuery({ confidence: null, insufficientKnowledge: false, reason: null })],
    });
    const { container } = renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() => {
      const circle = container.querySelector(".conf-circle") as HTMLElement | null;
      expect(circle?.textContent).toBe("—");
      expect(circle?.className).not.toContain("conf-low");
      expect(circle?.className).not.toContain("conf-mid");
      expect(screen.getByText("no reason given")).toBeInTheDocument();
    });
  });

  it("shows the empty state when nothing is flagged", async () => {
    mockDashboard({ failedQueries: [] });
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await waitFor(() =>
      expect(screen.getByText("No flagged answers yet — nothing to triage.")).toBeInTheDocument(),
    );
  });
});

describe("AdminHomePage — range control + reload", () => {
  it("defaults to a 30-day window and refetches when the range changes", async () => {
    mockDashboard();
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    const funnelCalls = () => apiCalls().filter((c) => c.pathname === "/admin/analytics/funnel");

    // Default range is 30d → funnel fetched with days=30.
    await waitFor(() => expect(funnelCalls().some((c) => c.url.includes("days=30"))).toBe(true));
    await screen.findByText("$15,999");

    // Switch to 7d → the dashboard reloads with days=7.
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() => expect(funnelCalls().some((c) => c.url.includes("days=7"))).toBe(true));
  });
});

describe("AdminHomePage — error states", () => {
  it("surfaces a load error when the analytics endpoints fail", async () => {
    // Leave the endpoints unmocked → every fetch 404s → the page shows the error badge
    // (the page renders `err.message`, which for a 404 is the client's "Request failed (404)").
    renderWithProviders(<AdminHomePage />, { role: "admin" });

    await screen.findByText("Request failed (404)");
    // No KPI grid renders on error.
    expect(screen.queryByText("MRR")).not.toBeInTheDocument();
  });
});
