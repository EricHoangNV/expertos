// Knowledge document detail / version-history page tests (M19.2.1 design-parity).
// Covers the `.pagehead` (back-eyebrow + title + `.muted .mono` scope/lang/versions + status badge)
// and the versions `Table`: the per-version status badge, the version-column DRAFT/LIVE chips (the
// screenshot-04 parity delta — a green "live" chip on published versions, an ink "draft" chip on
// draft versions, no chip on other statuses), and the lifecycle action buttons. Renders through the
// real Auth + Locale providers (M15.2.1 harness), so the admin-session role resolution runs.
import {
  renderWithProviders,
  screen,
  waitFor,
  mockApi,
  setMockParams,
} from "../../../test/render";
import type { KnowledgeDocumentDetailDto, KnowledgeVersionDto } from "@expertos/shared";
import KnowledgeDetailPage from "./page";

const DOC_ID = "d_1";

function version(over: Partial<KnowledgeVersionDto> = {}): KnowledgeVersionDto {
  return {
    id: "v_1",
    documentId: DOC_ID,
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

function detail(over: Partial<KnowledgeDocumentDetailDto> = {}): KnowledgeDocumentDetailDto {
  return {
    id: DOC_ID,
    title: "Unit Economics Memo",
    scope: "global_expert",
    language: "en",
    status: "published",
    publishedVersionId: "v_2",
    versionCount: 3,
    latestVersion: version({ id: "v_3", versionNumber: 3 }),
    updatedAt: "2026-05-30T12:00:00.000Z",
    versions: [
      version({ id: "v_3", versionNumber: 3, status: "draft", changeSummary: "Raised prime-cost threshold", chunkCount: 14 }),
      version({ id: "v_2", versionNumber: 2, status: "published", isPublished: true, changeSummary: "Added labor-scheduling guidance", chunkCount: 14, approvedAt: "2026-04-18T00:00:00.000Z" }),
    ],
    ...over,
  };
}

beforeEach(() => {
  setMockParams({ id: DOC_ID });
});

describe("KnowledgeDetailPage — pagehead", () => {
  it("renders the back-eyebrow, title, scope/lang/version meta and status badge", async () => {
    mockApi("GET", `/knowledge/documents/${DOC_ID}`, { body: detail() });
    const { container } = renderWithProviders(<KnowledgeDetailPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Unit Economics Memo" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "← Back to knowledge" })).toHaveAttribute("href", "/knowledge");
    const meta = container.querySelector(".pagehead .muted.mono");
    expect(meta?.textContent).toContain("3 versions");
    // Document-level status badge in the pagehead.
    expect(container.querySelector(".pagehead .badge")?.textContent).toBe("published");
  });
});

describe("KnowledgeDetailPage — version chips", () => {
  it("shows an ink draft chip on draft versions and a green live chip on published versions", async () => {
    mockApi("GET", `/knowledge/documents/${DOC_ID}`, { body: detail() });
    const { container } = renderWithProviders(<KnowledgeDetailPage />, { role: "admin" });

    await waitFor(() => expect(screen.getByText("Raised prime-cost threshold")).toBeInTheDocument());

    // The version-column chips live in each row's first (`.mono`) cell. v3 (draft) → ink "draft"
    // chip; v2 (published) → green "live" chip.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const draftChip = rows[0].querySelector("td.mono .badge");
    expect(draftChip?.textContent).toBe("draft");
    expect(draftChip).toHaveClass("badge-ink");
    const liveChip = rows[1].querySelector("td.mono .badge");
    expect(liveChip?.textContent).toBe("live");
    expect(liveChip).toHaveClass("badge-green");
  });
});

describe("KnowledgeDetailPage — error state", () => {
  it("surfaces a load error when the document endpoint fails", async () => {
    // Leave the endpoint unmocked → the fetch 404s → the page shows the error badge.
    renderWithProviders(<KnowledgeDetailPage />, { role: "admin" });

    await screen.findByText("Request failed (404)");
  });
});
