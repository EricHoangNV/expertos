/**
 * "My Knowledge" page tests (M18.3.5, per M15.1). Drives the real `/knowledge` page through the
 * M15.1.1 harness (real Auth + Locale providers over the manual-`fetch` mocks) to cover the M18
 * read+delete management surface: the Saved (persistent) vs Temporary (expiring) sections, the mode
 * + searchable-chunk badges, relative expiry copy, the delete flow (confirm → `DELETE /uploads/:id`
 * → row removed), the cancel path, and the signed-out / empty / error states.
 *
 * Dictionary key completeness for the new `knowledge` namespace (EN/VI lockstep) is covered by the
 * i18n suite (M15.1.5), which walks every namespace in the catalog automatically.
 */
import userEvent from "@testing-library/user-event";
import type { UploadedFileDto } from "@expertos/shared";
import KnowledgePage from "./page";
import {
  renderWithProviders,
  screen,
  waitFor,
  apiCalls,
  mockApi,
} from "../../test/render";

const DAY_MS = 24 * 60 * 60 * 1000;

function file(over: Partial<UploadedFileDto> = {}): UploadedFileDto {
  return {
    id: "ff000000-0000-0000-0000-000000000001",
    filename: "report.csv",
    contentType: "text/csv",
    sizeBytes: 2048,
    mode: "persistent",
    chunkCount: 3,
    scanned: true,
    scanClean: true,
    conversationId: null,
    expiresAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("KnowledgePage", () => {
  it("shows the sign-in prompt when signed out", async () => {
    renderWithProviders(<KnowledgePage />, { user: null });
    expect(
      await screen.findByText("Please sign in on the home page to view your knowledge."),
    ).toBeInTheDocument();
  });

  it("renders saved + temporary uploads with mode, searchable, and expiry detail", async () => {
    // +1h buffer so the component's render-time `now` (microseconds later) doesn't floor 3 → 2.
    const expiresAt = new Date(Date.now() + 3 * DAY_MS + 3_600_000).toISOString();
    mockApi("GET", "/uploads", {
      body: [
        file({ id: "ff000000-0000-0000-0000-000000000001", filename: "sop.md", chunkCount: 4 }),
        file({
          id: "ff000000-0000-0000-0000-000000000002",
          filename: "kpi.xlsx",
          mode: "temporary",
          chunkCount: 0,
          expiresAt,
        }),
      ],
    });
    renderWithProviders(<KnowledgePage />);

    expect(await screen.findByText("sop.md")).toBeInTheDocument();
    expect(screen.getByText("kpi.xlsx")).toBeInTheDocument();
    // Persistent → green "Saved" badge + searchable chunk count. "Saved" is also the section
    // heading, so both the heading and the row badge render it (≥ 2 occurrences).
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("4 searchable chunks")).toBeInTheDocument();
    // Temporary → "Temporary" badge (+ section heading), not-searchable badge, relative expiry.
    expect(screen.getAllByText("Temporary").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("stored — not searchable yet")).toBeInTheDocument();
    expect(screen.getByText("expires in 3 days")).toBeInTheDocument();
  });

  it("requests the list scoped to all uploads on mount", async () => {
    mockApi("GET", "/uploads", { body: [] });
    renderWithProviders(<KnowledgePage />);
    await waitFor(() => {
      const call = apiCalls().find((c) => c.method === "GET" && c.pathname === "/uploads");
      expect(call?.url).toContain("scope=all");
    });
  });

  it("deletes an upload after confirmation and removes its row", async () => {
    const user = userEvent.setup();
    mockApi("GET", "/uploads", { body: [file({ filename: "sop.md" })] });
    mockApi("DELETE", "/uploads/ff000000-0000-0000-0000-000000000001", { status: 204 });
    renderWithProviders(<KnowledgePage />);

    await screen.findByText("sop.md");
    await user.click(screen.getByRole("button", { name: "Delete sop.md" }));
    // The inline confirm step appears; the destructive action is the confirm button.
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const del = apiCalls().find((c) => c.method === "DELETE");
      expect(del?.pathname).toBe("/uploads/ff000000-0000-0000-0000-000000000001");
    });
    await waitFor(() => expect(screen.queryByText("sop.md")).not.toBeInTheDocument());
  });

  it("cancels the delete confirmation without calling the API", async () => {
    const user = userEvent.setup();
    mockApi("GET", "/uploads", { body: [file({ filename: "sop.md" })] });
    renderWithProviders(<KnowledgePage />);

    await screen.findByText("sop.md");
    await user.click(screen.getByRole("button", { name: "Delete sop.md" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("sop.md")).toBeInTheDocument();
    expect(apiCalls().some((c) => c.method === "DELETE")).toBe(false);
  });

  it("surfaces a delete error and keeps the row", async () => {
    const user = userEvent.setup();
    mockApi("GET", "/uploads", { body: [file({ filename: "sop.md" })] });
    mockApi("DELETE", "/uploads/ff000000-0000-0000-0000-000000000001", { status: 500 });
    renderWithProviders(<KnowledgePage />);

    await screen.findByText("sop.md");
    await user.click(screen.getByRole("button", { name: "Delete sop.md" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("Couldn't delete that — please try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("sop.md")).toBeInTheDocument();
  });

  it("shows the empty states when the user has no uploads", async () => {
    mockApi("GET", "/uploads", { body: [] });
    renderWithProviders(<KnowledgePage />);
    expect(
      await screen.findByText("Attach a document in chat and choose Persistent to save it here."),
    ).toBeInTheDocument();
    expect(screen.getByText("No temporary documents.")).toBeInTheDocument();
  });

  it("shows a load error when the list request fails", async () => {
    mockApi("GET", "/uploads", { status: 500 });
    renderWithProviders(<KnowledgePage />);
    expect(
      await screen.findByText("Couldn't load your documents — please try again."),
    ).toBeInTheDocument();
  });
});
