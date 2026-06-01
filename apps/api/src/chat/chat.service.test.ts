import { ChatService } from "./chat.service";
import type { ConversationService } from "./conversation.service";
import type { RetrievalService } from "../retrieval/retrieval.service";
import type { VoiceService } from "../voice/voice.service";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { ChatMessage, LlmProvider, RetrievedChunk } from "@expertos/ai";
import type { ChatRequestInput, ChatStreamEvent } from "@expertos/shared";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const CHUNKS: RetrievedChunk[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "fact one", score: 0.9 },
  { chunkId: "c2", documentVersionId: "dv1", content: "fact two", score: 0.8 },
];

const VOICE = {
  profile: { voiceProfileId: "vp1", expertName: "Dr. A", guidelines: "be concise" },
  examples: [{ id: "e1", prompt: "q?", content: "an example", score: 0.5 }],
  language: "en" as const,
};

function baseInput(over: Partial<ChatRequestInput> = {}): ChatRequestInput {
  return { text: "how do I file taxes", language: "en", topK: 8, ...over };
}

function makeService(opts: { streaming?: boolean; deltas?: string[] } = {}) {
  const streaming = opts.streaming ?? true;
  const deltas = opts.deltas ?? ["Answer [1]", "[2]."];
  const seenMessages: ChatMessage[][] = [];

  const retrieve = jest.fn().mockResolvedValue(CHUNKS);
  const retrieveUploads = jest.fn().mockResolvedValue([]);
  const retrieveVoice = jest.fn().mockResolvedValue(VOICE);
  const loadHistory = jest.fn().mockResolvedValue([
    { role: "user", content: "prev q" },
    { role: "assistant", content: "prev a" },
  ]);
  const persistTurn = jest
    .fn()
    .mockResolvedValue({ conversationId: "conv-1", messageId: "m-1" });
  const record = jest.fn().mockResolvedValue(undefined);
  const info = jest.fn();
  const error = jest.fn();

  const makeLlm = (name: string): LlmProvider =>
    streaming
      ? {
          name,
          complete: jest.fn(),
          completeStream: async function* (messages: ChatMessage[]) {
            seenMessages.push(messages);
            for (const delta of deltas) {
              yield { delta };
            }
            yield { usage: { promptTokens: 7, completionTokens: 3 } };
          },
        }
      : {
          name,
          complete: jest.fn(async (messages: ChatMessage[]) => {
            seenMessages.push(messages);
            return { text: "full answer", usage: { promptTokens: 5, completionTokens: 2 } };
          }),
        };

  const llm = makeLlm("stub-llm");
  const degradedLlm = makeLlm("stub-llm-mini");

  const service = new ChatService(
    { retrieve, retrieveUploads } as unknown as RetrievalService,
    { retrieveVoice } as unknown as VoiceService,
    { loadHistory, persistTurn } as unknown as ConversationService,
    llm,
    degradedLlm,
    { record } as unknown as UsageLogService,
    { info, error } as unknown as StructuredLogger,
  );

  return {
    service,
    stubs: {
      retrieve,
      retrieveUploads,
      retrieveVoice,
      loadHistory,
      persistTurn,
      record,
      info,
      error,
      seenMessages,
    },
  };
}

async function drain(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("ChatService.answerStream", () => {
  it("streams the answer, splices history, persists the turn, and resolves citations", async () => {
    const { service, stubs } = makeService();
    const input = baseInput({ conversationId: "conv-1", expertId: "ex-1" });

    const events = await drain(service.answerStream(USER, input));

    // Deltas concatenate to the model's answer.
    const text = events
      .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Answer [1][2].");

    // Voice + history were used; voice retrieval ran because an expert was chosen.
    expect(stubs.retrieveVoice).toHaveBeenCalledTimes(1);
    expect(stubs.loadHistory).toHaveBeenCalledWith(USER, "conv-1");

    // Prompt = [system, ...history, freshly-built user].
    const messages = stubs.seenMessages[0];
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "prev q" });
    expect(messages[2]).toEqual({ role: "assistant", content: "prev a" });
    expect(messages[3].role).toBe("user");
    expect(messages[3].content).toContain("fact one");

    // Persisted once, after generation, with provenance + citations.
    expect(stubs.persistTurn).toHaveBeenCalledTimes(1);
    expect(stubs.persistTurn.mock.calls[0][1]).toMatchObject({
      conversationId: "conv-1",
      expertId: "ex-1",
      userText: input.text,
      assistant: {
        content: "Answer [1][2].",
        model: "stub-llm",
        sourceVersionIds: ["dv1"],
        confidence: null,
      },
    });

    // Usage recorded against the chat feature with the streamed token counts.
    expect(stubs.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        featureKey: "chat.answer",
        model: "stub-llm",
        promptTokens: 7,
        completionTokens: 3,
        conversationId: "conv-1",
      }),
    );

    // Terminal done event carries the resolved, ordinal-indexed citations (OD#7).
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      conversationId: "conv-1",
      messageId: "m-1",
      insufficientKnowledge: false,
      citations: [
        { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", quote: "fact one", kind: "knowledge" },
        { ordinal: 2, chunkId: "c2", documentVersionId: "dv1", quote: "fact two", kind: "knowledge" },
      ],
    });
  });

  it("serves the cheaper degraded model when the fair-use gate degrades (M6.3)", async () => {
    const { service, stubs } = makeService();
    const input = baseInput({ conversationId: "conv-1" });

    const events = await drain(service.answerStream(USER, input, { degraded: true }));

    // The degraded provider's name is what gets persisted + cost-logged + flagged on the done event.
    expect(stubs.persistTurn.mock.calls[0][1].assistant.model).toBe("stub-llm-mini");
    expect(stubs.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ model: "stub-llm-mini" }),
    );
    expect(stubs.info).toHaveBeenCalledWith(
      "chat answer completed",
      expect.objectContaining({ degraded: true }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", degraded: true });
  });

  it("serves the standard model and reports degraded:false by default (M6.3)", async () => {
    const { service, stubs } = makeService();

    const events = await drain(service.answerStream(USER, baseInput()));

    expect(stubs.persistTurn.mock.calls[0][1].assistant.model).toBe("stub-llm");
    expect(events.at(-1)).toMatchObject({ type: "done", degraded: false });
  });

  it("folds the user's own uploads in as upload citations after knowledge (M5.4)", async () => {
    // Model cites a knowledge source [1] and the folded upload [3] (2 knowledge + 1 upload = 3).
    const { service, stubs } = makeService({ deltas: ["Per the docs [1]", " and your file [3]."] });
    stubs.retrieveUploads.mockResolvedValue([
      {
        uploadChunkId: "uc1",
        uploadedFileId: "uf1",
        filename: "budget.xlsx",
        content: "Q1 revenue was 1.2M",
        score: 0.95,
        sheetName: "Q1 KPIs",
        cellRef: "A2:B2",
      },
    ]);
    const input = baseInput({ conversationId: "conv-1" });

    const events = await drain(service.answerStream(USER, input));

    // Uploads were retrieved for the current conversation (temporary uploads are session-scoped).
    expect(stubs.retrieveUploads).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ text: input.text, conversationId: "conv-1" }),
    );

    // The upload's content is appended to the SOURCES block after the knowledge facts.
    const userMessage = stubs.seenMessages[0].at(-1)?.content ?? "";
    expect(userMessage).toContain("fact one");
    expect(userMessage).toContain("Q1 revenue was 1.2M");

    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      insufficientKnowledge: false,
      citations: [
        { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", kind: "knowledge" },
        {
          ordinal: 3,
          chunkId: "",
          documentVersionId: "",
          kind: "upload",
          sourceLabel: "budget.xlsx · Q1 KPIs!A2:B2",
        },
      ],
    });

    // Persisted: the upload citation carries `uploadChunkId`; provenance excludes the empty version.
    const turn = stubs.persistTurn.mock.calls[0][1];
    expect(turn.assistant.sourceVersionIds).toEqual(["dv1"]);
    expect(turn.assistant.citations).toEqual([
      expect.objectContaining({ ordinal: 1, chunkId: "c1", documentVersionId: "dv1" }),
      expect.objectContaining({ ordinal: 3, uploadChunkId: "uc1", chunkId: "", documentVersionId: "" }),
    ]);
  });

  it("is not insufficient when only an upload grounds the answer (M5.4)", async () => {
    const { service, stubs } = makeService({ deltas: ["From your upload [1]."] });
    stubs.retrieve.mockResolvedValue([]);
    stubs.retrieveUploads.mockResolvedValue([
      {
        uploadChunkId: "uc1",
        uploadedFileId: "uf1",
        filename: "notes.txt",
        content: "the answer is 42",
        score: 0.9,
        sheetName: null,
        cellRef: null,
      },
    ]);

    const done = (await drain(service.answerStream(USER, baseInput()))).at(-1);

    expect(done).toMatchObject({
      type: "done",
      insufficientKnowledge: false,
      citations: [{ ordinal: 1, kind: "upload", sourceLabel: "notes.txt" }],
    });
  });

  it("flags insufficient knowledge and emits no citations when retrieval finds nothing (M3.4)", async () => {
    const { service, stubs } = makeService();
    stubs.retrieve.mockResolvedValue([]);

    const events = await drain(service.answerStream(USER, baseInput()));

    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      insufficientKnowledge: true,
      citations: [],
    });
    // The turn is still persisted (the insufficient-knowledge answer is a real answer).
    expect(stubs.persistTurn).toHaveBeenCalledTimes(1);
    expect(stubs.persistTurn.mock.calls[0][1].assistant.sourceVersionIds).toEqual([]);
  });

  it("drops an unresolvable marker from the citations and the persisted answer (M4.1 guarantee)", async () => {
    // Model cites a real source [1] and a hallucinated one [9] (only 2 sources retrieved).
    const { service, stubs } = makeService({ deltas: ["Grounded [1]", " plus made up [9]."] });

    const events = await drain(service.answerStream(USER, baseInput()));

    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      insufficientKnowledge: false,
      citations: [{ ordinal: 1, chunkId: "c1", documentVersionId: "dv1", quote: "fact one" }],
    });
    // The dangling [9] is stripped from the persisted answer; the resolvable [1] is kept.
    expect(stubs.persistTurn.mock.calls[0][1].assistant.content).toBe("Grounded [1] plus made up.");
    expect(stubs.persistTurn.mock.calls[0][1].assistant.sourceVersionIds).toEqual(["dv1"]);
  });

  it("uses a neutral voice and skips history for a new conversation without an expert", async () => {
    const { service, stubs } = makeService();

    const events = await drain(service.answerStream(USER, baseInput()));

    expect(stubs.retrieveVoice).not.toHaveBeenCalled();
    expect(stubs.loadHistory).not.toHaveBeenCalled();
    // No history → [system, user] only.
    expect(stubs.seenMessages[0]).toHaveLength(2);
    expect(stubs.persistTurn.mock.calls[0][1]).toMatchObject({
      conversationId: undefined,
      expertId: undefined,
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("falls back to non-streaming complete() when the provider has no completeStream", async () => {
    const { service, stubs } = makeService({ streaming: false });

    const events = await drain(service.answerStream(USER, baseInput()));

    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas).toEqual([{ type: "delta", text: "full answer" }]);
    expect(stubs.persistTurn.mock.calls[0][1].assistant).toMatchObject({ content: "full answer" });
    expect(stubs.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ promptTokens: 5, completionTokens: 2 }),
    );
  });

  it("emits an error event and persists nothing when retrieval fails", async () => {
    const { service, stubs } = makeService();
    stubs.retrieve.mockRejectedValue(new Error("boom"));

    const events = await drain(service.answerStream(USER, baseInput()));

    expect(events).toEqual([{ type: "error", message: "Failed to generate an answer." }]);
    expect(stubs.persistTurn).not.toHaveBeenCalled();
    expect(stubs.error).toHaveBeenCalledWith(
      "chat answer failed",
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("stringifies a non-Error rejection when logging a failure", async () => {
    const { service, stubs } = makeService();
    stubs.retrieve.mockRejectedValue("plain string failure");

    const events = await drain(service.answerStream(USER, baseInput()));

    expect(events).toEqual([{ type: "error", message: "Failed to generate an answer." }]);
    expect(stubs.error).toHaveBeenCalledWith(
      "chat answer failed",
      expect.objectContaining({ message: "plain string failure" }),
    );
  });
});
