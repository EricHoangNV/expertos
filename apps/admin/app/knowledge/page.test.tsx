// Admin knowledge-approval kanban tests (M15.2.4) — the `app/knowledge/page.tsx` board (M13.3).
// Covers the 3-column kanban (column headers + pipeline count badges), the per-status card bodies
// (Draft summary, Expert Review approve/diff actions, Published live badge), the "Approve &
// publish" action (→ `POST /knowledge/versions/:id/approve` + reload), the
// status-pipeline step filter, the Conversation → Knowledge table (rows + empty state), and the
// load-error path. Renders through the real Auth + Locale providers (M15.2.1 harness), so the
// `POST /me/admin-session` admin-role resolution + the six board fetches run for real.
//
// Note on `waitFor` (LEARNINGS #19): the page double-loads on mount — the auth context recreates
// `getIdToken` when the admin-session resolves the role, re-firing the board's `load` (a transient
// `setData(null)` between the two fetch rounds). Data-dependent assertions are wrapped in `waitFor`
// so they retry past that brief reload window and assert the settled state.
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  mockApi,
  apiCalls,
} from "../../test/render";
import type {
  KnowledgeDocumentDto,
  KnowledgeDraftSummaryDto,
  KnowledgePipelineDto,
  KnowledgeVersionDto,
  PublishStatusValue,
} from "@expertos/shared";
import KnowledgeApprovalPage from "./page";

// ── Mock DTO factories ───────────────────────────────────────────────────────

function version(over: Partial<KnowledgeVersionDto> = {}): KnowledgeVersionDto {
  return {
    id: "v_1",
    documentId: "d_1",
    versionNumber: 1,
    status: "draft",
    changeSummary: null,
    chunkCount: 0,
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-05-30T12:00:00.000Z",
    isPublished: false,
    ...over,
  };
}

function doc(over: Partial<KnowledgeDocumentDto> = {}): KnowledgeDocumentDto {
  return {
    id: "d_1",
    title: "Untitled document",
    scope: "global_expert",
    language: "en",
    status: "draft",
    publishedVersionId: null,
    versionCount: 1,
    latestVersion: version(),
    updatedAt: "2026-05-30T12:00:00.000Z",
    ...over,
  };
}

function draft(over: Partial<KnowledgeDraftSummaryDto> = {}): KnowledgeDraftSummaryDto {
  return {
    id: "kd_1",
    title: "How do refunds work?",
    status: "expert_review",
    language: "en",
    conversationId: "c_1",
    createdAt: "2026-05-31T12:00:00.000Z",
    updatedAt: "2026-05-31T12:00:00.000Z",
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

/**
 * Register the six board endpoints. `listDocuments` is called once per status with a `?status=`
 * query, but the fetch mock keys on pathname only — so a single dynamic handler reads the status
 * off the URL and serves that column's docs from the supplied map.
 */
function mockBoard(over: {
  pipeline?: KnowledgePipelineDto;
  docs?: Partial<Record<PublishStatusValue, KnowledgeDocumentDto[]>>;
  drafts?: KnowledgeDraftSummaryDto[];
} = {}): void {
  const docsByStatus = over.docs ?? {};
  mockApi("GET", "/admin/analytics/knowledge-pipeline", { body: over.pipeline ?? pipeline() });
  mockApi("GET", "/knowledge/documents", (req) => {
    const status = new URL(req.url, "http://localhost").searchParams.get("status") as
      | PublishStatusValue
      | null;
    return { body: (status != null && docsByStatus[status]) || [] };
  });
  mockApi("GET", "/knowledge-drafts", { body: over.drafts ?? [draft()] });
}

describe("KnowledgeApprovalPage — kanban board", () => {
  it("renders three columns with status labels + pipeline count badges", async () => {
    mockBoard();
    const { container } = renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      const heads = container.querySelectorAll(".kanban-col-head");
      expect(heads).toHaveLength(3);
      const labels = Array.from(heads).map((h) => h.querySelector(".label")?.textContent);
      // `ai_processing` is a retained enum value with no board column (synchronous ingest).
      expect(labels).toEqual(["Draft", "Expert Review", "Published"]);
      // Count badges come from the pipeline rollup, not the (take:50-bounded) doc lists.
      const counts = Array.from(heads).map((h) => h.querySelector(".badge")?.textContent);
      expect(counts).toEqual(["3", "5", "42"]);
    });
  });

  it("renders a draft card with its title + change summary", async () => {
    mockBoard({
      docs: {
        draft: [doc({ id: "d_draft", title: "Pricing FAQ", latestVersion: version({ changeSummary: "Initial draft" }) })],
      },
    });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pricing FAQ" })).toHaveAttribute("href", "/knowledge/d_draft");
      expect(screen.getByText("Initial draft")).toBeInTheDocument();
    });
  });

  it("renders an Expert-Review card with approve + diff actions and the active highlight", async () => {
    mockBoard({
      docs: {
        expert_review: [doc({ id: "d_er", title: "Tax deadlines", status: "expert_review", latestVersion: version({ id: "v_er", status: "expert_review", changeSummary: "Updated Q3 dates" }) })],
      },
    });
    const { container } = renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("Updated Q3 dates")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve & publish" })).toBeEnabled();
      expect(screen.getByRole("link", { name: "Diff" })).toHaveAttribute("href", "/knowledge/d_er");
      // The first Expert Review card carries the amber active highlight.
      expect(container.querySelector(".kanban-card.is-active")).not.toBeNull();
    });
  });

  it("renders a Published card with the version-live badge + approval date", async () => {
    mockBoard({
      docs: {
        published: [doc({ id: "d_pub", title: "Refund policy", status: "published", latestVersion: version({ versionNumber: 4, status: "published", isPublished: true, approvedAt: "2026-05-20T00:00:00.000Z" }) })],
      },
    });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByText("v4 live")).toBeInTheDocument();
      // approvedAt → "approved · <localized date>" (date value is environment-formatted).
      expect(screen.getByText(/^approved · /)).toBeInTheDocument();
    });
  });

  it("shows the per-column empty state when a column has no documents", async () => {
    mockBoard(); // no docs supplied → every column is empty
    const { container } = renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      const empties = container.querySelectorAll(".kanban-empty");
      expect(empties).toHaveLength(3);
      expect(empties[0].textContent).toBe("Nothing here.");
    });
  });
});

describe("KnowledgeApprovalPage — approve action", () => {
  it("approves a version (POST /knowledge/versions/:id/approve) and reloads the board", async () => {
    mockBoard({
      docs: {
        expert_review: [doc({ id: "d_er", title: "Tax deadlines", status: "expert_review", latestVersion: version({ id: "v_er", status: "expert_review" }) })],
      },
    });
    mockApi("POST", "/knowledge/versions/v_er/approve", { body: version({ id: "v_er", status: "published" }) });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    const button = await screen.findByRole("button", { name: "Approve & publish" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(apiCalls().some((c) => c.method === "POST" && c.pathname === "/knowledge/versions/v_er/approve")).toBe(true),
    );
    // The board reloads after the transition — the pipeline endpoint is hit again.
    await waitFor(() =>
      expect(apiCalls().filter((c) => c.pathname === "/admin/analytics/knowledge-pipeline").length).toBeGreaterThan(1),
    );
  });

  it("surfaces an error badge when the approve transition fails", async () => {
    mockBoard({
      docs: {
        expert_review: [doc({ id: "d_er", title: "Tax deadlines", status: "expert_review", latestVersion: version({ id: "v_er", status: "expert_review" }) })],
      },
    });
    mockApi("POST", "/knowledge/versions/v_er/approve", { status: 500, body: { message: "Boom" } });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    fireEvent.click(await screen.findByRole("button", { name: "Approve & publish" }));
    // The client surfaces the API `{ message }` body; the page renders it in the error badge.
    await screen.findByText("Boom");
  });
});

describe("KnowledgeApprovalPage — status pipeline filter", () => {
  it("filters the board to a single column when a step is toggled", async () => {
    mockBoard();
    const { container } = renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => expect(container.querySelectorAll(".kanban-col")).toHaveLength(3));

    // The step buttons share their labels with the column heads; pick the step toolbar's button.
    const step = container.querySelector('.kanban-step[aria-pressed]') as HTMLElement;
    // Click the "Published" step to filter to just that column.
    const publishedStep = Array.from(container.querySelectorAll(".kanban-step")).find(
      (b) => b.textContent === "Published",
    ) as HTMLElement;
    fireEvent.click(publishedStep);

    await waitFor(() => {
      const cols = container.querySelectorAll(".kanban-col");
      expect(cols).toHaveLength(1);
      expect(cols[0].querySelector(".kanban-col-head .label")?.textContent).toBe("Published");
    });
    expect(step).toBeInTheDocument(); // sanity: the step toolbar rendered
  });
});

describe("KnowledgeApprovalPage — Conversation → Knowledge", () => {
  it("renders a draft row with its status badge + Draft action link", async () => {
    mockBoard({ drafts: [draft({ id: "kd_9", title: "Do you offer annual billing?", status: "expert_review", conversationId: "c_9" })] });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Do you offer annual billing?" })).toHaveAttribute(
        "href",
        "/knowledge-drafts/kd_9",
      );
      // From-chat draft → "yes"; status badge renders the localized lifecycle label.
      expect(screen.getByText("yes")).toBeInTheDocument();
      expect(screen.getByText("expert review")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Draft" })).toHaveAttribute("href", "/knowledge-drafts/kd_9");
    });
  });

  it("shows the empty state when there are no conversation-sourced drafts", async () => {
    mockBoard({ drafts: [] });
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await waitFor(() =>
      expect(screen.getByText("No conversation-sourced drafts yet.")).toBeInTheDocument(),
    );
  });
});

describe("KnowledgeApprovalPage — error state", () => {
  it("surfaces a load error when the board endpoints fail", async () => {
    // Leave the endpoints unmocked → every fetch 404s → the page shows the error badge.
    renderWithProviders(<KnowledgeApprovalPage />, { role: "admin" });

    await screen.findByText("Request failed (404)");
    // No kanban board renders on error.
    expect(document.querySelector(".kanban-col")).toBeNull();
  });
});
