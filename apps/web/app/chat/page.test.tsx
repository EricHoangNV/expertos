/**
 * Chat page tests (M15.1.2). Drives the real `/chat` page through the M15.1.1 harness
 * (real Auth + Locale providers over the firebase + manual-`fetch` mocks) to cover the
 * core consumer journeys: message rendering (user bubble + assistant answer + citations),
 * the send → SSE-stream → append flow, voice-picker selection, layout-direction switching,
 * the empty + signed-out states, the stream error path, and the three post-answer notices
 * (insufficient-knowledge / high-stakes / fair-use degrade).
 *
 * The send flow exercises `streamChat`'s SSE parser for real: `mockApi("POST","/chat",{sse})`
 * serves `data:`-framed events as a `ReadableStream` body, so the page consumes them exactly
 * as it does against the live API.
 */
import userEvent from "@testing-library/user-event";
import type { ChatStreamEvent } from "@expertos/shared";
import { HIGH_STAKES_DISCLAIMERS } from "@expertos/shared";
import ChatPage from "./page";
import {
  renderWithProviders,
  screen,
  waitFor,
  apiCalls,
  mockApi,
  makeMockUser,
} from "../../test/render";

/** A metered `ask_question` entitlement so the sidebar usage meter + input quota render. */
function entitlements(used = 3, limit = 200) {
  return {
    plan: { key: "plus", name: "Plus" },
    features: [
      {
        key: "ask_question",
        name: "Questions",
        type: "metered" as const,
        enabled: true,
        limit,
        softLimit: null,
        window: "month" as const,
        used,
        remaining: limit - used,
      },
    ],
  };
}

/** Register the three best-effort mount fetches so they don't fall through to 404 noise. */
function mockMountFetches(opts: { experts?: unknown[] } = {}) {
  mockApi("GET", "/experts", { body: opts.experts ?? [] });
  mockApi("GET", "/conversations", { body: [] });
  mockApi("GET", "/me/entitlements", { body: entitlements() });
}

/** A `done` frame with one resolved knowledge citation. */
const DONE_WITH_CITATION: ChatStreamEvent = {
  type: "done",
  conversationId: "conv-1",
  messageId: "msg-1",
  citations: [
    {
      ordinal: 1,
      chunkId: "chunk-1",
      documentVersionId: "dv-1",
      quote: "Cash flow is the lifeblood of a small business.",
      kind: "knowledge",
    },
  ],
  insufficientKnowledge: false,
};

/** Mock a chat turn: an SSE stream of the given prose delta + a done frame. */
function mockChatTurn(delta: string, done: ChatStreamEvent = DONE_WITH_CITATION) {
  mockApi("POST", "/chat", { sse: [{ type: "delta", text: delta }, done] });
}

/** Type a question and click Send. */
async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText("Your question"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

describe("ChatPage", () => {
  it("renders the empty state for a signed-in user", async () => {
    mockMountFetches();
    renderWithProviders(<ChatPage />);
    expect(await screen.findByText("Start a new conversation")).toBeInTheDocument();
  });

  it("shows the sign-in prompt when signed out", async () => {
    renderWithProviders(<ChatPage />, { user: null });
    expect(
      await screen.findByText("Please sign in on the home page to start chatting."),
    ).toBeInTheDocument();
  });

  it("sends a question and appends the streamed answer with a user bubble", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockChatTurn("Focus on cash flow first. [1]");
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    await ask(user, "How do I grow my business?");

    // User bubble echoes the question.
    expect(await screen.findByText("How do I grow my business?")).toBeInTheDocument();
    // Assistant prose streamed in (prose splits the [1] marker out, so match the lead text).
    expect(await screen.findByText(/Focus on cash flow first\./)).toBeInTheDocument();

    // The POST /chat turn carried the typed text.
    const chatCall = apiCalls().find((c) => c.method === "POST" && c.pathname === "/chat");
    expect(chatCall).toBeDefined();
    expect((chatCall?.body as { text: string }).text).toBe("How do I grow my business?");
  });

  it("resolves the citation into the sources rail after the stream completes", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockChatTurn("Cash is king. [1]");
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    // Render-after-resolve: no passage count before any answer.
    expect(screen.queryByText("1 passage")).not.toBeInTheDocument();

    await ask(user, "What matters most?");

    // Once the done frame resolves the citation, the rail shows the passage count + trust badge.
    expect(await screen.findByText("1 passage")).toBeInTheDocument();
    expect(
      screen.getByText("All citations resolved to a real chunk"),
    ).toBeInTheDocument();
  });

  it("sends the selected expert voice on the next turn", async () => {
    const user = userEvent.setup();
    mockMountFetches({
      experts: [{ expertId: "exp-1", displayName: "Dr. Jane Smith", languages: ["en"] }],
    });
    mockChatTurn("In my experience, start small. [1]");
    renderWithProviders(<ChatPage />);

    // The voice picker appears once the experts load; select the expert chip.
    await user.click(await screen.findByRole("button", { name: "Dr. Jane Smith" }));
    // The placeholder follows the selected voice.
    expect(
      await screen.findByPlaceholderText("Ask Dr. Jane Smith anything about your business…"),
    ).toBeInTheDocument();

    await ask(user, "Where do I begin?");

    await waitFor(() => {
      const chatCall = apiCalls().find((c) => c.method === "POST" && c.pathname === "/chat");
      expect((chatCall?.body as { expertId?: string }).expertId).toBe("exp-1");
    });
  });

  it("switches layout direction and persists it to localStorage", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    renderWithProviders(<ChatPage />);

    // The Tweaks panel is open by default with the layout segmented control.
    await user.click(await screen.findByRole("button", { name: "Focus" }));

    expect(window.localStorage.getItem("expertos:chat-layout-direction")).toBe("focus");
    // Focus mode drops the persistent sources rail.
    await waitFor(() =>
      expect(
        screen.queryByText("All citations resolved to a real chunk"),
      ).not.toBeInTheDocument(),
    );
  });

  it("surfaces an error when the chat stream request fails", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockApi("POST", "/chat", { status: 500 });
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    await ask(user, "This will fail");

    expect(await screen.findByText(/chat request failed \(500\)/)).toBeInTheDocument();
  });

  it("shows the insufficient-knowledge notice when no sources were retrieved", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockChatTurn("I'm not certain about that.", {
      type: "done",
      conversationId: "conv-1",
      messageId: "msg-1",
      citations: [],
      insufficientKnowledge: true,
    });
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    await ask(user, "Obscure question");

    expect(await screen.findByText(/I couldn’t find enough in the expert’s knowledge base/))
      .toBeInTheDocument();
  });

  it("shows the high-stakes disclaimer when the answer is flagged", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockChatTurn("Generally, consult a professional. [1]", {
      ...DONE_WITH_CITATION,
      highStakes: true,
    });
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    await ask(user, "Should I sue my landlord?");

    expect(await screen.findByText(HIGH_STAKES_DISCLAIMERS.en)).toBeInTheDocument();
  });

  it("shows the fair-use note when the answer was degraded", async () => {
    const user = userEvent.setup();
    mockMountFetches();
    mockChatTurn("Quick answer. [1]", { ...DONE_WITH_CITATION, degraded: true });
    renderWithProviders(<ChatPage />);
    await screen.findByLabelText("Your question");

    await ask(user, "Another question");

    expect(
      await screen.findByText(/Answered with a lighter model/),
    ).toBeInTheDocument();
  });
});
