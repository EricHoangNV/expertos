// Admin/expert concierge review-queue tests (M15.2.6) — the `app/concierge-reviews/page.tsx`
// two-pane queue + review detail (M13.6). Covers the `.review-pane` layout (queue list + detail),
// the Open/Mine/Done triage filter, auto-selection + detail load (question + AI answer), verdict
// selection, the verdict-record + refined-answer submit (`POST /concierge-reviews/:id/respond`),
// the escalate action (`POST /concierge-reviews/:id/escalate`), the admin expert-picker gate, and
// the load-error path. Renders through the real Auth + Locale providers (M15.2.1 harness), so the
// `POST /me/admin-session` role resolution + the queue/detail fetches run for real.
//
// Most tests render as `role: "expert"` — an expert is scoped to their own voice by the API, so the
// queue loads directly with no expert picker (the admin path is exercised in its own block).
//
// Note on settling (LEARNINGS #19/#20): the page re-loads as the admin-session role resolves
// (recreating `getIdToken` → re-firing the queue/detail effects). Data-dependent assertions are
// wrapped in `waitFor`, and interactions wait for the detail pane to load (the AI answer to render)
// before driving the verdict form, so a residual reload doesn't wipe typed edits.
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  mockApi,
  apiCalls,
} from "../../test/render";
import type {
  AdminExpertSummaryDto,
  ReviewQueueDetailDto,
  ReviewQueueItemDto,
} from "@expertos/shared";
import ConciergeReviewsPage from "./page";

// ── Mock DTO factories ───────────────────────────────────────────────────────

function item(over: Partial<ReviewQueueItemDto> = {}): ReviewQueueItemDto {
  return {
    id: "r_1",
    messageId: "m_1",
    conversationId: "c_1",
    triggerMode: "auto_silent",
    visibility: "silent",
    confidenceScore: 0.4,
    status: "requested",
    slaDueAt: "2026-06-03T00:00:00.000Z",
    claimedAt: null,
    answeredAt: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    answerPreview: "The deduction applies for the first three years.",
    latestVerdict: null,
    responseCount: 0,
    ...over,
  };
}

function detail(over: Partial<ReviewQueueDetailDto> = {}): ReviewQueueDetailDto {
  return {
    id: "r_1",
    messageId: "m_1",
    conversationId: "c_1",
    triggerMode: "auto_silent",
    visibility: "silent",
    confidenceScore: 0.4,
    status: "requested",
    slaDueAt: "2026-06-03T00:00:00.000Z",
    claimedAt: null,
    answeredAt: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    answer: "The deduction applies for the first three years of operation.",
    question: "How long does the startup deduction last?",
    responses: [],
    ...over,
  };
}

function expert(over: Partial<AdminExpertSummaryDto> = {}): AdminExpertSummaryDto {
  return {
    id: "ex_1",
    slug: "jane-doe",
    displayName: "Jane Doe",
    title: "Tax advisor",
    active: true,
    voiceProfileCount: 1,
    createdAt: "2026-04-01T12:00:00.000Z",
    ...over,
  };
}

/** Register the queue list + the detail endpoint for a single open item (the common case). */
function mockQueue(
  rows: ReviewQueueItemDto[],
  details: Record<string, ReviewQueueDetailDto> = {},
): void {
  mockApi("GET", "/concierge-reviews", { body: rows });
  for (const r of rows) {
    mockApi("GET", `/concierge-reviews/${r.id}`, { body: details[r.id] ?? detail({ id: r.id }) });
  }
}

// ── Two-pane layout + rendering ───────────────────────────────────────────────

describe("ConciergeReviewsPage — two-pane layout", () => {
  it("renders the queue list + detail panes with the open count and SLA chip", async () => {
    mockQueue([
      item({ id: "r_1", answerPreview: "First flagged answer." }),
      item({ id: "r_2", answerPreview: "Second flagged answer." }),
    ]);
    const { container } = renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    await waitFor(() => {
      expect(container.querySelector(".review-pane")).not.toBeNull();
      expect(container.querySelector(".queue-list")).not.toBeNull();
      expect(container.querySelector(".review-detail")).not.toBeNull();
      // Both open items appear, and the open-count + SLA chip render in the header.
      expect(screen.getByText("First flagged answer.")).toBeInTheDocument();
      expect(screen.getByText("Second flagged answer.")).toBeInTheDocument();
      expect(screen.getByText("Queue · 2 open")).toBeInTheDocument();
      expect(screen.getByText("SLA 24h")).toBeInTheDocument();
    });
  });

  it("auto-selects the first item and loads its detail (question + AI answer)", async () => {
    mockQueue([item({ id: "r_1" })], {
      r_1: detail({
        id: "r_1",
        question: "How long does the startup deduction last?",
        answer: "The deduction applies for the first three years of operation.",
      }),
    });
    const { container } = renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    await waitFor(() => {
      expect(screen.getByText("How long does the startup deduction last?")).toBeInTheDocument();
      // The answer also pre-fills the refined-answer textarea, so scope to the answer paragraph.
      expect(container.querySelector(".review-answer")?.textContent).toBe(
        "The deduction applies for the first three years of operation.",
      );
      // The first queue item carries the active highlight.
      expect(container.querySelector(".queue-item.is-active")).not.toBeNull();
    });
  });

  it("shows the empty state + select prompt when the queue is empty", async () => {
    mockQueue([]);
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    await waitFor(() => {
      expect(screen.getByText("Nothing awaiting review.")).toBeInTheDocument();
      // With nothing selected, the detail pane shows its prompt.
      expect(
        screen.getByText("Select a review to see the question, answer, and verdict."),
      ).toBeInTheDocument();
    });
  });
});

// ── Triage filter (Open / Mine / Done) ────────────────────────────────────────

describe("ConciergeReviewsPage — triage filter", () => {
  it("Open shows only requested/in_review, Done shows the rest", async () => {
    mockQueue([
      item({ id: "r_open", status: "requested", answerPreview: "Open item." }),
      item({ id: "r_done", status: "answered", answerPreview: "Done item.", latestVerdict: "good" }),
    ]);
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    // Default tab = Open → only the open item is listed.
    await waitFor(() => expect(screen.getByText("Open item.")).toBeInTheDocument());
    expect(screen.queryByText("Done item.")).not.toBeInTheDocument();

    // Switch to Done → the answered item appears, the open one drops.
    fireEvent.click(screen.getByRole("tab", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Done item.")).toBeInTheDocument());
    expect(screen.queryByText("Open item.")).not.toBeInTheDocument();
  });

  it("Mine shows only claimed items", async () => {
    mockQueue([
      item({ id: "r_claimed", claimedAt: "2026-06-02T01:00:00.000Z", answerPreview: "Claimed item." }),
      item({ id: "r_unclaimed", claimedAt: null, answerPreview: "Unclaimed item." }),
    ]);
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    await waitFor(() => expect(screen.getByText("Claimed item.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "Mine" }));
    await waitFor(() => {
      expect(screen.getByText("Claimed item.")).toBeInTheDocument();
      expect(screen.queryByText("Unclaimed item.")).not.toBeInTheDocument();
    });
  });

  it("shows the per-tab empty copy when a tab has no items", async () => {
    mockQueue([item({ id: "r_open", status: "requested" })]);
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    await waitFor(() => expect(screen.getByRole("tab", { name: "Done" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByText("No completed reviews yet.")).toBeInTheDocument(),
    );
  });
});

// ── Verdict selection + submit ────────────────────────────────────────────────

describe("ConciergeReviewsPage — verdict + refined answer", () => {
  it("selects a verdict card (aria-pressed reflects the choice)", async () => {
    mockQueue([item({ id: "r_1" })]);
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    // Wait for the detail (and therefore the verdict cards) to render.
    await screen.findByText("Your verdict");
    const good = screen.getByRole("button", { name: /Good/ });
    const great = screen.getByRole("button", { name: /Great/ });
    // Default verdict is "good".
    expect(good).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(great);
    expect(great).toHaveAttribute("aria-pressed", "true");
    expect(good).toHaveAttribute("aria-pressed", "false");
  });

  it("records a verdict-only response (revisedAnswer null when unchanged) and reloads", async () => {
    mockQueue([item({ id: "r_1" })]);
    mockApi("POST", "/concierge-reviews/r_1/respond", {
      body: {
        id: "rr_1",
        reviewerId: "ex_1",
        verdict: "good",
        originalAnswer: "x",
        revisedAnswer: null,
        edited: false,
        notes: null,
        deliveredToUser: false,
        createdAt: "2026-06-02T02:00:00.000Z",
      },
    });
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    fireEvent.click(await screen.findByRole("button", { name: "Record verdict" }));

    await waitFor(() => {
      const post = apiCalls().find(
        (c) => c.method === "POST" && c.pathname === "/concierge-reviews/r_1/respond",
      );
      expect(post).toBeDefined();
      // Unedited → revisedAnswer null; default verdict "good".
      expect(post!.body).toMatchObject({ verdict: "good", revisedAnswer: null });
    });
    // After the verdict commits the queue reloads from the top. The page's queue load carries an
    // `offset=` param (the AdminFrame nav-count fetch does not), so count those distinctly.
    await waitFor(() =>
      expect(
        apiCalls().filter(
          (c) => c.pathname === "/concierge-reviews" && c.url.includes("offset="),
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it("editing the answer flips the CTA to Push refined update and sends the revised text", async () => {
    mockQueue([item({ id: "r_1" })], {
      r_1: detail({ id: "r_1", answer: "Original answer text." }),
    });
    mockApi("POST", "/concierge-reviews/r_1/respond", {
      body: {
        id: "rr_1",
        reviewerId: "ex_1",
        verdict: "good",
        originalAnswer: "Original answer text.",
        revisedAnswer: "Refined answer text.",
        edited: true,
        notes: null,
        deliveredToUser: true,
        createdAt: "2026-06-02T02:00:00.000Z",
      },
    });
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    // The refined-answer textarea is pre-filled with the original answer.
    const textarea = (await screen.findByText("Refined answer"))
      .closest(".review-section")!
      .querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Original answer text.");

    // Before editing the CTA records a verdict; after editing it pushes a refined update.
    expect(screen.getByRole("button", { name: "Record verdict" })).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "Refined answer text." } });
    const cta = await screen.findByRole("button", { name: "Push refined update" });

    fireEvent.click(cta);
    await waitFor(() => {
      const post = apiCalls().find(
        (c) => c.method === "POST" && c.pathname === "/concierge-reviews/r_1/respond",
      );
      expect(post).toBeDefined();
      expect(post!.body).toMatchObject({ verdict: "good", revisedAnswer: "Refined answer text." });
    });
  });
});

// ── Escalate ──────────────────────────────────────────────────────────────────

describe("ConciergeReviewsPage — escalate", () => {
  it("escalates the review to a paid consultation (POST escalate)", async () => {
    mockQueue([item({ id: "r_1" })]);
    mockApi("POST", "/concierge-reviews/r_1/escalate", {
      body: {
        reviewRequestId: "r_1",
        status: "escalated",
        consultationId: "cons_1",
        consultationTypeKey: "deep-dive",
        tidycalLink: "https://tidycal.com/x",
      },
    });
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });

    fireEvent.click(await screen.findByRole("button", { name: "Escalate to paid consultation" }));

    await waitFor(() =>
      expect(
        apiCalls().some(
          (c) => c.method === "POST" && c.pathname === "/concierge-reviews/r_1/escalate",
        ),
      ).toBe(true),
    );
  });
});

// ── Admin expert picker ───────────────────────────────────────────────────────

describe("ConciergeReviewsPage — admin expert picker", () => {
  it("prompts an admin to pick an expert before the queue loads", async () => {
    mockApi("GET", "/admin/experts", { body: [expert()] });
    mockQueue([item({ id: "r_1" })]);
    const { container } = renderWithProviders(<ConciergeReviewsPage />, { role: "admin" });

    // Until an expert is chosen, the queue stays hidden behind the select prompt.
    await waitFor(() =>
      expect(screen.getByText("Select an expert to review their queue.")).toBeInTheDocument(),
    );
    expect(container.querySelector(".review-pane")).toBeNull();

    // Wait for the roster to populate the picker, then select the expert (the only combobox) to
    // load that expert's queue.
    await screen.findByRole("option", { name: "Jane Doe" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ex_1" } });
    await waitFor(() => {
      expect(container.querySelector(".review-pane")).not.toBeNull();
      // The page's queue load carries the chosen expert (distinct from the AdminFrame nav-count
      // fetch, which has no expertId).
      expect(
        apiCalls().some(
          (c) =>
            c.method === "GET" &&
            c.pathname === "/concierge-reviews" &&
            c.url.includes("expertId=ex_1"),
        ),
      ).toBe(true);
    });
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("ConciergeReviewsPage — error state", () => {
  it("surfaces a load error when the queue endpoint fails", async () => {
    // Leave `/concierge-reviews` unmocked → 404 → the page renders the error badge. (An expert's
    // pane still renders its loading shell — the queue rows just never arrive.)
    renderWithProviders(<ConciergeReviewsPage />, { role: "expert" });
    await screen.findByText("Request failed (404)");
  });
});
