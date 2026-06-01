import { NotFoundException } from "@nestjs/common";
import { ConversationService, type ConversationTurn } from "./conversation.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

function makeTx() {
  return {
    conversation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    message: { findMany: jest.fn(), create: jest.fn() },
    citation: {
      create: jest.fn().mockResolvedValue({ id: "cit" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRawUnsafe: jest.fn(),
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new ConversationService(rls), run };
}

const TURN: ConversationTurn = {
  language: "en",
  userText: "how do I file taxes",
  assistant: {
    content: "File via the portal [1].",
    sourceVersionIds: ["dv1"],
    model: "echo-dev",
    confidence: null,
    citations: [
      { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "Use the portal." },
      { ordinal: 2, chunkId: "c2", documentVersionId: "dv2", content: "Deadline is April." },
    ],
  },
};

describe("ConversationService.loadHistory", () => {
  it("returns the within-budget, chronological user/assistant history", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    // Stored DESC (newest first); the service reverses to chronological.
    tx.message.findMany.mockResolvedValue([
      { role: "assistant", content: "a2" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q1" },
    ]);
    const { service, run } = makeService(tx);

    const history = await service.loadHistory(USER, "conv-1");

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
    // The DB read is bounded by a hard row backstop (HISTORY_MAX_MESSAGES); the token budget then
    // trims within that. Short messages all fit, so the full set is replayed here.
    const args = tx.message.findMany.mock.calls[0][0];
    expect(args.take).toBe(40);
    expect(args.where).toEqual({
      conversationId: "conv-1",
      role: { in: ["user", "assistant"] },
    });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("windows by token budget, keeping the most recent whole messages", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    // ~600 estimated tokens each (~450 words / 0.75). Two fit the 1500-token budget; the third
    // (oldest) would push over it and is dropped — whole-message, newest-first.
    const big = (tag: string) => `${tag} ${"word ".repeat(450)}`.trim();
    tx.message.findMany.mockResolvedValue([
      { role: "assistant", content: big("a2") },
      { role: "user", content: big("q2") },
      { role: "assistant", content: big("a1") },
    ]);
    const { service } = makeService(tx);

    const history = await service.loadHistory(USER, "conv-1");

    expect(history).toHaveLength(2);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history[0].content).toBe(big("q2"));
    expect(history[1].content).toBe(big("a2"));
  });

  it("always keeps the single most recent message even when it exceeds the budget", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    // One message far larger than the whole budget — it must still be carried so a follow-up
    // never loses its immediate antecedent.
    const huge = `q ${"word ".repeat(5000)}`.trim();
    tx.message.findMany.mockResolvedValue([{ role: "user", content: huge }]);
    const { service } = makeService(tx);

    const history = await service.loadHistory(USER, "conv-1");

    expect(history).toEqual([{ role: "user", content: huge }]);
  });

  it("throws NotFound when the conversation is not the acting user's", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.loadHistory(USER, "conv-x")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.message.findMany).not.toHaveBeenCalled();
  });
});

describe("ConversationService.persistTurn", () => {
  it("appends to an existing conversation and writes ordinal-indexed citations", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.message.create.mockResolvedValue({ id: "assist-1" });
    const { service } = makeService(tx);

    const result = await service.persistTurn(USER, { ...TURN, conversationId: "conv-1" });

    expect(result).toEqual({ conversationId: "conv-1", messageId: "assist-1" });
    expect(tx.conversation.create).not.toHaveBeenCalled();
    // user message then assistant message.
    expect(tx.message.create).toHaveBeenCalledTimes(2);
    expect(tx.message.create.mock.calls[0][0].data).toMatchObject({
      conversationId: "conv-1",
      role: "user",
      content: TURN.userText,
      tenantId: USER.tenantId,
    });
    expect(tx.message.create.mock.calls[1][0].data).toMatchObject({
      role: "assistant",
      content: TURN.assistant.content,
      model: "echo-dev",
      sourceVersionIds: ["dv1"],
      confidence: null,
    });
    expect(tx.citation.create).toHaveBeenCalledTimes(2);
    expect(tx.citation.create.mock.calls[0][0].data).toMatchObject({
      messageId: "assist-1",
      ordinal: 1,
      chunkId: "c1",
      documentVersionId: "dv1",
      quote: "Use the portal.",
    });
    expect(tx.citation.create.mock.calls[1][0].data).toMatchObject({ ordinal: 2, chunkId: "c2" });
  });

  it("persists the true marker ordinal, not the loop index, for a sparse citation list (M4.2)", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.message.create.mockResolvedValue({ id: "assist-sparse" });
    const { service } = makeService(tx);

    // The model cited only `[2]` — the M4.1 builder keeps that ordinal rather than renumbering to 1.
    await service.persistTurn(USER, {
      ...TURN,
      conversationId: "conv-1",
      assistant: {
        ...TURN.assistant,
        content: "See the deadline [2].",
        citations: [{ ordinal: 2, chunkId: "c2", documentVersionId: "dv2", content: "April." }],
      },
    });

    expect(tx.citation.create).toHaveBeenCalledTimes(1);
    // ordinal 2 (the real marker), NOT 1 (the loop index) — keeps it aligned with the prose.
    expect(tx.citation.create.mock.calls[0][0].data).toMatchObject({ ordinal: 2, chunkId: "c2" });
  });

  it("creates a new conversation with voice attribution and an auto-derived title", async () => {
    const tx = makeTx();
    tx.conversation.create.mockResolvedValue({ id: "conv-new" });
    tx.message.create.mockResolvedValue({ id: "assist-2" });
    const { service } = makeService(tx);

    const result = await service.persistTurn(USER, { ...TURN, expertId: "ex-1" });

    expect(result.conversationId).toBe("conv-new");
    expect(tx.conversation.findUnique).not.toHaveBeenCalled();
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      expertId: "ex-1",
      language: "en",
      // Auto-title is the (whitespace-collapsed) first question.
      title: "how do I file taxes",
    });
  });

  it("collapses whitespace and truncates a long first question into the title", async () => {
    const tx = makeTx();
    tx.conversation.create.mockResolvedValue({ id: "conv-long" });
    tx.message.create.mockResolvedValue({ id: "assist-long" });
    const { service } = makeService(tx);

    const userText = `What   are\tthe   ${"detailed ".repeat(20)}steps to incorporate a company`;
    await service.persistTurn(USER, { ...TURN, userText });

    const title: string = tx.conversation.create.mock.calls[0][0].data.title;
    expect(title.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  "); // whitespace collapsed
    expect(title.startsWith("What are the detailed")).toBe(true);
  });

  it("hard-cuts a single over-long word that has no space to break on", async () => {
    const tx = makeTx();
    tx.conversation.create.mockResolvedValue({ id: "conv-word" });
    tx.message.create.mockResolvedValue({ id: "assist-word" });
    const { service } = makeService(tx);

    const userText = "a".repeat(120);
    await service.persistTurn(USER, { ...TURN, userText });

    const title: string = tx.conversation.create.mock.calls[0][0].data.title;
    expect(title).toBe(`${"a".repeat(80)}…`);
  });

  it("stores a null expert when starting a neutral-voice conversation", async () => {
    const tx = makeTx();
    tx.conversation.create.mockResolvedValue({ id: "conv-neutral" });
    tx.message.create.mockResolvedValue({ id: "assist-3" });
    const { service } = makeService(tx);

    await service.persistTurn(USER, TURN);

    expect(tx.conversation.create.mock.calls[0][0].data.expertId).toBeNull();
  });

  it("throws NotFound when continuing a conversation the user does not own", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.persistTurn(USER, { ...TURN, conversationId: "conv-x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.message.create).not.toHaveBeenCalled();
  });
});

const CONV_ROW = {
  id: "conv-1",
  title: "how do I file taxes",
  expertId: "ex-1",
  language: "en",
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:05:00.000Z"),
};

describe("ConversationService.list", () => {
  it("returns the user's conversations as summaries, newest activity first", async () => {
    const tx = makeTx();
    tx.conversation.findMany.mockResolvedValue([CONV_ROW]);
    const { service, run } = makeService(tx);

    const result = await service.list(USER, { limit: 20, offset: 0 });

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(result).toEqual([
      {
        id: "conv-1",
        title: "how do I file taxes",
        expertId: "ex-1",
        language: "en",
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:05:00.000Z",
      },
    ]);
    const args = tx.conversation.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
  });
});

describe("ConversationService.get", () => {
  it("returns the conversation transcript with re-hydrated citations on assistant messages", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(CONV_ROW);
    tx.message.findMany.mockResolvedValue([
      {
        id: "m1",
        role: "user",
        content: "q1",
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      },
      {
        id: "m2",
        role: "assistant",
        content: "a1 [2]",
        createdAt: new Date("2026-06-01T10:01:00.000Z"),
      },
    ]);
    // A sparse citation: the assistant cited only `[2]`, and `uploadChunkId` is null → knowledge.
    tx.citation.findMany.mockResolvedValue([
      {
        messageId: "m2",
        ordinal: 2,
        chunkId: "c2",
        documentVersionId: "dv2",
        uploadChunkId: null,
        quote: "April.",
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.get(USER, "conv-1");

    expect(result.id).toBe("conv-1");
    expect(result.messages).toEqual([
      { id: "m1", role: "user", content: "q1", createdAt: "2026-06-01T10:00:00.000Z", citations: [] },
      {
        id: "m2",
        role: "assistant",
        content: "a1 [2]",
        createdAt: "2026-06-01T10:01:00.000Z",
        citations: [
          {
            ordinal: 2,
            chunkId: "c2",
            documentVersionId: "dv2",
            quote: "April.",
            kind: "knowledge",
          },
        ],
      },
    ]);
    // Citations are looked up only for the assistant message id, ascending by marker ordinal.
    expect(tx.citation.findMany.mock.calls[0][0]).toMatchObject({
      where: { messageId: { in: ["m2"] } },
      orderBy: { ordinal: "asc" },
    });
    expect(tx.message.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("derives an upload citation kind and tolerates null chunk ids on the read path", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(CONV_ROW);
    tx.message.findMany.mockResolvedValue([
      {
        id: "m2",
        role: "assistant",
        content: "from your file [1]",
        createdAt: new Date("2026-06-01T10:01:00.000Z"),
      },
    ]);
    tx.citation.findMany.mockResolvedValue([
      {
        messageId: "m2",
        ordinal: 1,
        chunkId: null,
        documentVersionId: null,
        uploadChunkId: "uc1",
        // A null quote (no stored preview) collapses to undefined on the DTO.
        quote: null,
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.get(USER, "conv-1");

    expect(result.messages[0].citations).toEqual([
      { ordinal: 1, chunkId: "", documentVersionId: "", quote: undefined, kind: "upload" },
    ]);
  });

  it("returns empty citations and skips the citation read when there are no assistant messages", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(CONV_ROW);
    tx.message.findMany.mockResolvedValue([
      { id: "m1", role: "user", content: "q1", createdAt: new Date("2026-06-01T10:00:00.000Z") },
    ]);
    const { service } = makeService(tx);

    const result = await service.get(USER, "conv-1");

    expect(result.messages).toEqual([
      { id: "m1", role: "user", content: "q1", createdAt: "2026-06-01T10:00:00.000Z", citations: [] },
    ]);
    // No assistant messages → the citation lookup is skipped entirely.
    expect(tx.citation.findMany).not.toHaveBeenCalled();
  });

  it("throws NotFound when the conversation is not the acting user's", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.get(USER, "conv-x")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.message.findMany).not.toHaveBeenCalled();
  });
});

describe("ConversationService.search", () => {
  const SEARCH_ROW = {
    id: "conv-1",
    title: "how do I file taxes",
    expert_id: "ex-1",
    language: "en",
    created_at: new Date("2026-06-01T10:00:00.000Z"),
    updated_at: new Date("2026-06-01T10:05:00.000Z"),
    message_id: "m-9",
    snippet: "File via the «portal»",
  };

  it("maps raw search rows into conversation hits and binds q/limit/offset", async () => {
    const tx = makeTx();
    tx.$queryRawUnsafe.mockResolvedValue([SEARCH_ROW]);
    const { service, run } = makeService(tx);

    const result = await service.search(USER, { q: "portal", limit: 20, offset: 0 });

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(result).toEqual([
      {
        conversation: {
          id: "conv-1",
          title: "how do I file taxes",
          expertId: "ex-1",
          language: "en",
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
        snippet: "File via the «portal»",
        messageId: "m-9",
      },
    ]);
    // Bound params in order: query text, limit, offset (never interpolated).
    const [sql, q, limit, offset] = tx.$queryRawUnsafe.mock.calls[0];
    expect(q).toBe("portal");
    expect(limit).toBe(20);
    expect(offset).toBe(0);
    expect(sql).toContain("websearch_to_tsquery('simple', $1)");
    expect(sql).toContain("LIMIT $2 OFFSET $3");
  });

  it("returns a title-only hit with a null snippet and message id", async () => {
    const tx = makeTx();
    tx.$queryRawUnsafe.mockResolvedValue([
      { ...SEARCH_ROW, message_id: null, snippet: null },
    ]);
    const { service } = makeService(tx);

    const [hit] = await service.search(USER, { q: "taxes", limit: 20, offset: 0 });

    expect(hit.messageId).toBeNull();
    expect(hit.snippet).toBeNull();
    expect(hit.conversation.title).toBe("how do I file taxes");
  });

  it("returns an empty list when nothing matches", async () => {
    const tx = makeTx();
    tx.$queryRawUnsafe.mockResolvedValue([]);
    const { service } = makeService(tx);

    await expect(service.search(USER, { q: "nope", limit: 20, offset: 0 })).resolves.toEqual([]);
  });
});

describe("ConversationService.rename", () => {
  it("updates the title after confirming ownership", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.conversation.update.mockResolvedValue({ ...CONV_ROW, title: "My taxes" });
    const { service } = makeService(tx);

    const result = await service.rename(USER, "conv-1", "My taxes");

    expect(result.title).toBe("My taxes");
    expect(tx.conversation.update.mock.calls[0][0]).toMatchObject({
      where: { id: "conv-1" },
      data: { title: "My taxes" },
    });
  });

  it("throws NotFound when renaming a conversation the user does not own", async () => {
    const tx = makeTx();
    tx.conversation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.rename(USER, "conv-x", "x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });
});
