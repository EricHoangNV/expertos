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
    conversation: { findUnique: jest.fn(), create: jest.fn() },
    message: { findMany: jest.fn(), create: jest.fn() },
    citation: { create: jest.fn().mockResolvedValue({ id: "cit" }) },
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
      { chunkId: "c1", documentVersionId: "dv1", content: "Use the portal." },
      { chunkId: "c2", documentVersionId: "dv2", content: "Deadline is April." },
    ],
  },
};

describe("ConversationService.loadHistory", () => {
  it("returns the capped, chronological user/assistant history", async () => {
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
    const args = tx.message.findMany.mock.calls[0][0];
    expect(args.take).toBe(10);
    expect(args.where).toEqual({
      conversationId: "conv-1",
      role: { in: ["user", "assistant"] },
    });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
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

  it("creates a new conversation with voice attribution when none is given", async () => {
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
    });
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
