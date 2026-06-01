import type { PrismaClient } from "@expertos/db";
import type { EmbeddingProvider } from "@expertos/ai";
import { ConciergeFlywheelService, type FlywheelInput } from "./concierge-flywheel.service";
import type { StructuredLogger } from "../observability/logger.service";

const REQUEST = {
  messageId: "m1",
  message: {
    content: "The original AI answer.",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    conversationId: "conv-1",
    conversation: { expertId: "expert-1", language: "en" },
  },
};

function makeTx() {
  return {
    humanReviewRequest: { findUnique: jest.fn().mockResolvedValue(REQUEST) },
    message: { findFirst: jest.fn().mockResolvedValue({ content: "How do I do X?" }) },
    knowledgeDraft: { create: jest.fn().mockResolvedValue({ id: "kd-1" }) },
    voiceProfile: { findFirst: jest.fn().mockResolvedValue({ id: "vp-1" }) },
    citation: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ chunkId: "c1" }, { chunkId: "c2" }, { chunkId: "c1" }, { chunkId: null }]),
    },
    chunk: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  const embeddings = {
    embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  } as unknown as jest.Mocked<EmbeddingProvider>;
  const logger = { info: jest.fn(), error: jest.fn() } as unknown as jest.Mocked<StructuredLogger>;
  return { service: new ConciergeFlywheelService(prisma, embeddings, logger), tx, embeddings, logger };
}

const TENANT_ID = "20000000-0000-0000-0000-000000000001";

const GREAT: FlywheelInput = {
  reviewRequestId: "rr-1",
  tenantId: TENANT_ID,
  verdict: "great",
  improvedAnswer: "A polished, expert-voiced answer.",
  edited: true,
};

describe("ConciergeFlywheelService.applyReviewOutcome", () => {
  it("mints a knowledge draft + embedded voice example for a great/edited answer", async () => {
    const tx = makeTx();
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    expect(tx.knowledgeDraft.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        conversationId: "conv-1",
        expertId: "expert-1",
        title: "How do I do X?",
        content: "How do I do X?\n\nA polished, expert-voiced answer.",
        language: "en",
        status: "draft",
      },
    });
    // voice example embedded with the captured answer, then raw-inserted.
    expect(embeddings.embed).toHaveBeenCalledWith(["A polished, expert-voiced answer."]);
    expect(tx.voiceProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expertId: "expert-1", language: "en", status: "published" },
      }),
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO voice_examples"),
      expect.any(String), // generated uuid
      TENANT_ID,
      "vp-1",
      "How do I do X?",
      "A polished, expert-voiced answer.",
      "en",
      "[0.10000000,0.20000000,0.30000000]",
    );
  });

  it("treats an edit under a non-great verdict as a positive contribution", async () => {
    const tx = makeTx();
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome({ ...GREAT, verdict: "good", edited: true });

    expect(tx.knowledgeDraft.create).toHaveBeenCalled();
    expect(embeddings.embed).toHaveBeenCalled();
  });

  it("flags the source chunks (deduped, non-null) for a bad verdict", async () => {
    const tx = makeTx();
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome({ ...GREAT, verdict: "bad", edited: false });

    expect(tx.citation.findMany).toHaveBeenCalledWith({
      where: { messageId: "m1", chunkId: { not: null } },
      select: { chunkId: true },
    });
    expect(tx.chunk.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      data: { flagCount: { increment: 1 }, lastFlaggedAt: expect.any(Date) },
    });
    // a bad verdict is not a positive contribution — no draft / voice capture.
    expect(tx.knowledgeDraft.create).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("does nothing for a verdict-only 'good' (not edited)", async () => {
    const tx = makeTx();
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome({ ...GREAT, verdict: "good", edited: false });

    expect(tx.knowledgeDraft.create).not.toHaveBeenCalled();
    expect(tx.chunk.updateMany).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("drafts but skips the voice example when the conversation has no expert", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findUnique.mockResolvedValue({
      ...REQUEST,
      message: { ...REQUEST.message, conversation: { expertId: null, language: "en" } },
    });
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    expect(tx.knowledgeDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expertId: null }) }),
    );
    // No voice profile to capture against → no embed, no voice-example insert.
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(tx.voiceProfile.findFirst).not.toHaveBeenCalled();
  });

  it("drafts but skips the voice example when the expert has no published profile", async () => {
    const tx = makeTx();
    tx.voiceProfile.findFirst.mockResolvedValue(null);
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    expect(tx.knowledgeDraft.create).toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("truncates a long prompting question into the draft title", async () => {
    const tx = makeTx();
    const longQuestion = "x".repeat(200);
    tx.message.findFirst.mockResolvedValue({ content: longQuestion });
    const { service } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    const data = tx.knowledgeDraft.create.mock.calls[0][0].data as { title: string };
    expect(data.title).toBe(`${"x".repeat(80)}…`);
  });

  it("falls back to a generic title when there is no prompting question", async () => {
    const tx = makeTx();
    tx.message.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    expect(tx.knowledgeDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Reviewed answer",
          content: "A polished, expert-voiced answer.",
        }),
      }),
    );
  });

  it("no-ops when the review request no longer exists", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findUnique.mockResolvedValue(null);
    const { service, embeddings } = makeService(tx);

    await service.applyReviewOutcome(GREAT);

    expect(tx.knowledgeDraft.create).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("does not flag when the bad answer cited no knowledge chunks", async () => {
    const tx = makeTx();
    tx.citation.findMany.mockResolvedValue([]);
    const { service } = makeService(tx);

    await service.applyReviewOutcome({ ...GREAT, verdict: "bad", edited: false });

    expect(tx.chunk.updateMany).not.toHaveBeenCalled();
  });

  it("swallows errors so a flywheel hiccup never fails the recorded verdict", async () => {
    const tx = makeTx();
    tx.knowledgeDraft.create.mockRejectedValue(new Error("db down"));
    const { service, logger } = makeService(tx);

    await expect(service.applyReviewOutcome(GREAT)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "concierge flywheel failed",
      expect.objectContaining({ reviewRequestId: "rr-1", message: "db down" }),
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const tx = makeTx();
    tx.knowledgeDraft.create.mockRejectedValue("boom");
    const { service, logger } = makeService(tx);

    await expect(service.applyReviewOutcome(GREAT)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "concierge flywheel failed",
      expect.objectContaining({ message: "boom" }),
    );
  });
});
