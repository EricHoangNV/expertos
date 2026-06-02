/**
 * History page tests (M15.1.3). Drives the real `/history` page through the M15.1.1 harness
 * (real Auth + Locale providers over the firebase + manual-`fetch` mocks) to cover the M3.2/M3.3
 * journeys: the recent-conversation list, full-text search (with snippet), opening a conversation
 * into its transcript (message replay + per-answer save), the inline rename, the saved-answers
 * panel (load + remove), and the signed-out + empty states.
 */
import userEvent from "@testing-library/user-event";
import type {
  ConversationDetailDto,
  ConversationSearchResultDto,
  ConversationSummaryDto,
  SavedAnswerDto,
} from "@expertos/shared";
import HistoryPage from "./page";
import {
  renderWithProviders,
  screen,
  waitFor,
  apiCalls,
  mockApi,
} from "../../test/render";

const NOW = "2026-06-02T10:00:00.000Z";

/** A conversation summary row. */
function conversation(
  id: string,
  title: string | null,
  updatedAt = NOW,
): ConversationSummaryDto {
  return {
    id,
    title,
    expertId: null,
    language: "en",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt,
  };
}

/** A full transcript: a user question + an assistant answer carrying one knowledge citation. */
function detail(id: string, title: string | null): ConversationDetailDto {
  return {
    ...conversation(id, title),
    messages: [
      {
        id: "msg-user",
        role: "user",
        content: "How do I price my product?",
        createdAt: NOW,
        citations: [],
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content: "Anchor on value, not cost. [1]",
        createdAt: NOW,
        citations: [
          {
            ordinal: 1,
            chunkId: "chunk-1",
            documentVersionId: "dv-1",
            quote: "Value-based pricing outperforms cost-plus.",
            kind: "knowledge",
          },
        ],
      },
    ],
  };
}

/** A saved-answer bookmark row. */
function savedAnswer(id: string, conversationId = "conv-1"): SavedAnswerDto {
  return {
    id,
    conversationId,
    messageId: "msg-assistant",
    note: null,
    createdAt: NOW,
  };
}

/** Register the two mount fetches (conversation list + saved answers) the page issues on load. */
function mockMountFetches(opts: {
  conversations?: ConversationSummaryDto[];
  saved?: SavedAnswerDto[];
} = {}) {
  mockApi("GET", "/conversations", { body: opts.conversations ?? [] });
  mockApi("GET", "/saved-answers", { body: opts.saved ?? [] });
}

describe("HistoryPage", () => {
  it("shows the sign-in prompt when signed out", async () => {
    renderWithProviders(<HistoryPage />, { user: null });
    expect(
      await screen.findByText("Please sign in on the home page to view your history."),
    ).toBeInTheDocument();
  });

  it("renders the empty state when the user has no conversations", async () => {
    mockMountFetches();
    renderWithProviders(<HistoryPage />);
    expect(
      await screen.findByText("No conversations yet. Start one from the Chat page."),
    ).toBeInTheDocument();
  });

  it("lists the user's recent conversations", async () => {
    mockMountFetches({
      conversations: [
        conversation("conv-1", "Pricing strategy"),
        conversation("conv-2", "Hiring my first employee"),
      ],
    });
    renderWithProviders(<HistoryPage />);

    expect(await screen.findByRole("button", { name: "Pricing strategy" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hiring my first employee" }),
    ).toBeInTheDocument();
  });

  it("runs a full-text search and renders the matching conversation with its snippet", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    const results: ConversationSearchResultDto[] = [
      {
        conversation: conversation("conv-7", "Cash flow basics"),
        snippet: "«Cash» flow is the lifeblood of the business",
        messageId: "msg-1",
      },
    ];
    mockApi("GET", "/conversations/search", { body: results });
    renderWithProviders(<HistoryPage />);
    await screen.findByText("No conversations yet. Start one from the Chat page.");

    await user.type(screen.getByPlaceholderText("Search titles and messages…"), "cash");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Search results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cash flow basics" })).toBeInTheDocument();
    expect(
      screen.getByText("«Cash» flow is the lifeblood of the business"),
    ).toBeInTheDocument();

    // The query reached the search endpoint.
    const searchCall = apiCalls().find((c) => c.pathname === "/conversations/search");
    expect(searchCall?.url).toContain("q=cash");
  });

  it("shows a no-match message when search returns nothing", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockApi("GET", "/conversations/search", { body: [] });
    renderWithProviders(<HistoryPage />);
    await screen.findByText("No conversations yet. Start one from the Chat page.");

    await user.type(screen.getByPlaceholderText("Search titles and messages…"), "nope");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No conversations matched.")).toBeInTheDocument();
  });

  it("opens a conversation and replays its transcript with the cited answer", async () => {
    const user = userEvent.setup();
    mockMountFetches({ conversations: [conversation("conv-1", "Pricing strategy")] });
    mockApi("GET", "/conversations/conv-1", { body: detail("conv-1", "Pricing strategy") });
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole("button", { name: "Pricing strategy" }));

    // Both turns replay; the assistant prose lead text renders (the [1] marker is split out).
    expect(await screen.findByText("How do I price my product?")).toBeInTheDocument();
    expect(screen.getByText(/Anchor on value, not cost\./)).toBeInTheDocument();
  });

  it("saves an answer from the transcript and reflects the saved state", async () => {
    const user = userEvent.setup();
    mockMountFetches({ conversations: [conversation("conv-1", "Pricing strategy")] });
    mockApi("GET", "/conversations/conv-1", { body: detail("conv-1", "Pricing strategy") });
    mockApi("POST", "/saved-answers", { body: { ok: true } });
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole("button", { name: "Pricing strategy" }));
    await user.click(await screen.findByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const saveCall = apiCalls().find(
      (c) => c.method === "POST" && c.pathname === "/saved-answers",
    );
    expect((saveCall?.body as { messageId: string }).messageId).toBe("msg-assistant");
  });

  it("renames a conversation from the detail view", async () => {
    const user = userEvent.setup();
    mockMountFetches({ conversations: [conversation("conv-1", "Old title")] });
    mockApi("GET", "/conversations/conv-1", { body: detail("conv-1", "Old title") });
    mockApi("PATCH", "/conversations/conv-1", {
      body: conversation("conv-1", "New title"),
    });
    renderWithProviders(<HistoryPage />);

    await user.click(await screen.findByRole("button", { name: "Old title" }));
    await user.click(await screen.findByRole("button", { name: "Rename" }));

    const input = screen.getByLabelText("Conversation title");
    await user.clear(input);
    await user.type(input, "New title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "New title" })).toBeInTheDocument();
    const patchCall = apiCalls().find(
      (c) => c.method === "PATCH" && c.pathname === "/conversations/conv-1",
    );
    expect((patchCall?.body as { title: string }).title).toBe("New title");
  });

  it("lists saved answers and removes one", async () => {
    const user = userEvent.setup();
    mockMountFetches({ saved: [savedAnswer("saved-1")] });
    mockApi("DELETE", "/saved-answers/saved-1", { status: 204 });
    renderWithProviders(<HistoryPage />);

    // The saved-answers panel renders its bookmark with a Remove control once loaded.
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument(),
    );
    expect(
      apiCalls().some(
        (c) => c.method === "DELETE" && c.pathname === "/saved-answers/saved-1",
      ),
    ).toBe(true);
  });

  it("surfaces an error when loading conversations fails", async () => {
    mockApi("GET", "/conversations", { status: 500 });
    mockApi("GET", "/saved-answers", { body: [] });
    renderWithProviders(<HistoryPage />);

    expect(
      await screen.findByText("Couldn't load your conversations — please try again."),
    ).toBeInTheDocument();
  });
});
