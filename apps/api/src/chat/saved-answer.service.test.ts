import { ConflictException, NotFoundException } from "@nestjs/common";
import { SavedAnswerService } from "./saved-answer.service";
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
    savedAnswer: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new SavedAnswerService(rls), run };
}

const SAVED_ROW = {
  id: "saved-1",
  conversationId: "conv-1",
  messageId: "msg-1",
  note: "useful",
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
};

describe("SavedAnswerService.create", () => {
  it("bookmarks an assistant answer in a conversation the user owns", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "assistant",
      conversationId: "conv-1",
    });
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.savedAnswer.findUnique.mockResolvedValue(null);
    tx.savedAnswer.create.mockResolvedValue(SAVED_ROW);
    const { service, run } = makeService(tx);

    const result = await service.create(USER, { messageId: "msg-1", note: "useful" });

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(result).toEqual({
      id: "saved-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      note: "useful",
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    expect(tx.savedAnswer.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      conversationId: "conv-1",
      messageId: "msg-1",
      note: "useful",
    });
  });

  it("stores a null note when none is given", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "assistant",
      conversationId: "conv-1",
    });
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.savedAnswer.findUnique.mockResolvedValue(null);
    tx.savedAnswer.create.mockResolvedValue({ ...SAVED_ROW, note: null });
    const { service } = makeService(tx);

    const result = await service.create(USER, { messageId: "msg-1" });

    expect(result.note).toBeNull();
    expect(tx.savedAnswer.create.mock.calls[0][0].data.note).toBeNull();
  });

  it("throws NotFound when the message is missing or not an answer", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "user",
      conversationId: "conv-1",
    });
    const { service } = makeService(tx);

    await expect(service.create(USER, { messageId: "msg-1" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
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

    await expect(service.create(USER, { messageId: "msg-1" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.savedAnswer.create).not.toHaveBeenCalled();
  });

  it("throws Conflict when the answer is already bookmarked", async () => {
    const tx = makeTx();
    tx.message.findUnique.mockResolvedValue({
      id: "msg-1",
      role: "assistant",
      conversationId: "conv-1",
    });
    tx.conversation.findUnique.mockResolvedValue({ id: "conv-1" });
    tx.savedAnswer.findUnique.mockResolvedValue({ id: "saved-1" });
    const { service } = makeService(tx);

    await expect(service.create(USER, { messageId: "msg-1" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.savedAnswer.create).not.toHaveBeenCalled();
  });
});

describe("SavedAnswerService.list", () => {
  it("returns the user's bookmarks newest first", async () => {
    const tx = makeTx();
    tx.savedAnswer.findMany.mockResolvedValue([SAVED_ROW]);
    const { service } = makeService(tx);

    const result = await service.list(USER, { limit: 20, offset: 0 });

    expect(result).toEqual([
      {
        id: "saved-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        note: "useful",
        createdAt: "2026-06-01T10:00:00.000Z",
      },
    ]);
    const args = tx.savedAnswer.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(20);
    expect(args.skip).toBe(0);
  });
});

describe("SavedAnswerService.remove", () => {
  it("deletes a bookmark the user owns", async () => {
    const tx = makeTx();
    tx.savedAnswer.findUnique.mockResolvedValue({ id: "saved-1" });
    tx.savedAnswer.delete.mockResolvedValue({ id: "saved-1" });
    const { service } = makeService(tx);

    await service.remove(USER, "saved-1");

    expect(tx.savedAnswer.delete).toHaveBeenCalledWith({ where: { id: "saved-1" } });
  });

  it("throws NotFound when the bookmark is not the user's", async () => {
    const tx = makeTx();
    tx.savedAnswer.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.remove(USER, "saved-x")).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.savedAnswer.delete).not.toHaveBeenCalled();
  });
});
