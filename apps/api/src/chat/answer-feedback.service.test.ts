import { NotFoundException } from "@nestjs/common";
import { AnswerFeedbackService } from "./answer-feedback.service";
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
    message: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    answerFeedback: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new AnswerFeedbackService(rls), run };
}

const FEEDBACK_ROW = {
  id: "fb-1",
  messageId: "msg-1",
  helpful: true,
  reason: "spot on",
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
};

/** Wires the ownership lookups to a message + conversation the user owns. */
function ownsAnswer(tx: ReturnType<typeof makeTx>) {
  tx.message.findUnique.mockResolvedValue({
    id: "msg-1",
    role: "assistant",
    conversationId: "conv-1",
  });
  tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
}

describe("AnswerFeedbackService.submit", () => {
  it("creates feedback on an assistant answer the user owns", async () => {
    const tx = makeTx();
    ownsAnswer(tx);
    tx.answerFeedback.findUnique.mockResolvedValue(null);
    tx.answerFeedback.create.mockResolvedValue(FEEDBACK_ROW);
    const { service, run } = makeService(tx);

    const result = await service.submit(USER, {
      messageId: "msg-1",
      helpful: true,
      reason: "spot on",
    });

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(result).toEqual({
      id: "fb-1",
      messageId: "msg-1",
      helpful: true,
      reason: "spot on",
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    expect(tx.answerFeedback.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      messageId: "msg-1",
      helpful: true,
      reason: "spot on",
    });
    expect(tx.answerFeedback.update).not.toHaveBeenCalled();
  });

  it("stores a null reason when none is given", async () => {
    const tx = makeTx();
    ownsAnswer(tx);
    tx.answerFeedback.findUnique.mockResolvedValue(null);
    tx.answerFeedback.create.mockResolvedValue({ ...FEEDBACK_ROW, helpful: false, reason: null });
    const { service } = makeService(tx);

    const result = await service.submit(USER, { messageId: "msg-1", helpful: false });

    expect(result.reason).toBeNull();
    expect(result.helpful).toBe(false);
    expect(tx.answerFeedback.create.mock.calls[0][0].data.reason).toBeNull();
  });

  it("updates the existing verdict when feedback already exists (upsert, no conflict)", async () => {
    const tx = makeTx();
    ownsAnswer(tx);
    tx.answerFeedback.findUnique.mockResolvedValue({ id: "fb-1" });
    tx.answerFeedback.update.mockResolvedValue({ ...FEEDBACK_ROW, helpful: false, reason: null });
    const { service } = makeService(tx);

    const result = await service.submit(USER, { messageId: "msg-1", helpful: false });

    expect(result.helpful).toBe(false);
    expect(tx.answerFeedback.update).toHaveBeenCalledWith({
      where: { id: "fb-1" },
      data: { helpful: false, reason: null },
      select: expect.any(Object),
    });
    expect(tx.answerFeedback.create).not.toHaveBeenCalled();
  });

  it("throws NotFound when the message is missing or not an answer", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "user",
      conversationId: "conv-1",
    });
    const { service } = makeService(tx);

    await expect(
      service.submit(USER, { messageId: "msg-1", helpful: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.conversation.findUnique).not.toHaveBeenCalled();
  });

  it("throws NotFound when the answer's conversation is not the user's", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "assistant",
      conversationId: "conv-other",
    });
    // RLS hides a peer's conversation → findUnique returns null.
    tx.conversation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.submit(USER, { messageId: "msg-1", helpful: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.answerFeedback.create).not.toHaveBeenCalled();
    expect(tx.answerFeedback.update).not.toHaveBeenCalled();
  });
});

describe("AnswerFeedbackService.remove", () => {
  it("retracts feedback the user owns, keyed by message", async () => {
    const tx = makeTx();
    tx.answerFeedback.findUnique.mockResolvedValue({ id: "fb-1" });
    tx.answerFeedback.delete.mockResolvedValue({ id: "fb-1" });
    const { service } = makeService(tx);

    await service.remove(USER, "msg-1");

    expect(tx.answerFeedback.findUnique).toHaveBeenCalledWith({
      where: { userId_messageId: { userId: USER.id, messageId: "msg-1" } },
      select: { id: true },
    });
    expect(tx.answerFeedback.delete).toHaveBeenCalledWith({ where: { id: "fb-1" } });
  });

  it("throws NotFound when there is no feedback to retract", async () => {
    const tx = makeTx();
    tx.answerFeedback.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.remove(USER, "msg-x")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.answerFeedback.delete).not.toHaveBeenCalled();
  });
});
