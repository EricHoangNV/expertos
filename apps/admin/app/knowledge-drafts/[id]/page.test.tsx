// Knowledge-draft detail / editor page tests (M19.2.3 design-parity).
// Covers the screenshot-06 parity delta — the info-callout `.panel` above the Title field that
// renders the static "auto-drafted" note ONLY for drafts promoted from a conversation (real
// `conversationId` signal, never faked) — plus the pagehead back-eyebrow + status badge and the
// Title/Content editor. Renders through the real Auth + Locale providers (M15.2.1 harness).
import {
  renderWithProviders,
  screen,
  waitFor,
  mockApi,
  setMockParams,
} from "../../../test/render";
import type { KnowledgeDraftDto } from "@expertos/shared";
import DraftDetailPage from "./page";

const DRAFT_ID = "kd_1";

function draft(over: Partial<KnowledgeDraftDto> = {}): KnowledgeDraftDto {
  return {
    id: DRAFT_ID,
    title: "Goodwill valuation on acquiring an existing unit",
    status: "expert_review",
    language: "en",
    conversationId: "c_1",
    content: "Goodwill is the premium a buyer pays over the tangible asset value of a unit.",
    createdAt: "2026-05-30T12:00:00.000Z",
    updatedAt: "2026-05-30T12:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  setMockParams({ id: DRAFT_ID });
});

describe("DraftDetailPage — auto-drafted callout", () => {
  it("shows the info-callout note for a draft promoted from a conversation", async () => {
    mockApi("GET", `/knowledge-drafts/${DRAFT_ID}`, { body: draft() });
    const { container } = renderWithProviders(<DraftDetailPage />, { role: "admin" });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Goodwill valuation on acquiring an existing unit" }),
      ).toBeInTheDocument();
    });
    const callout = container.querySelector(".panel.card-pad");
    expect(callout?.textContent).toContain("Auto-drafted from low-confidence asks");
    // Status badge in the pagehead.
    expect(container.querySelector(".pagehead .badge")?.textContent).toBe("expert review");
  });

  it("omits the callout for a manually-authored draft (no conversation)", async () => {
    mockApi("GET", `/knowledge-drafts/${DRAFT_ID}`, { body: draft({ conversationId: null }) });
    const { container } = renderWithProviders(<DraftDetailPage />, { role: "admin" });

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeInTheDocument();
    });
    expect(container.querySelector(".panel.card-pad")).toBeNull();
  });
});

describe("DraftDetailPage — error state", () => {
  it("surfaces a load error when the draft endpoint fails", async () => {
    renderWithProviders(<DraftDetailPage />, { role: "admin" });
    await screen.findByText("Request failed (404)");
  });
});
