import type { PrismaClient } from "@expertos/db";
import { ConciergeQueueService } from "./concierge-queue.service";
import type { StructuredLogger } from "../observability/logger.service";
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

const BASE_INPUT = {
  messageId: "33333333-3333-3333-3333-333333333333",
  conversationId: "44444444-4444-4444-4444-444444444444",
  insufficientKnowledge: true,
  confidence: null as number | null,
};

/** Mode B (auto-silent) enabled config. */
const MODE_B = {
  enabled: true,
  triggerMode: "auto_silent" as const,
  confidenceThreshold: 0.5,
  slaHours: 24,
  volumeCapPerDay: 50,
};

function makeTx() {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    reviewConfig: { findFirst: jest.fn().mockResolvedValue(MODE_B) },
    humanReviewRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: "req-1" }),
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  const info = jest.fn();
  const error = jest.fn();
  const logger = { info, error } as unknown as StructuredLogger;
  return { service: new ConciergeQueueService(prisma, logger), tx, info, error };
}

describe("ConciergeQueueService.enqueueIfTriggered", () => {
  it("queues a silent review when Mode B is enabled and the answer is insufficient", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.$executeRawUnsafe).toHaveBeenCalled(); // elevated (is_admin) context applied
    expect(tx.humanReviewRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: USER.tenantId,
        userId: USER.id,
        messageId: BASE_INPUT.messageId,
        triggerMode: "auto_silent",
        visibility: "silent",
        confidenceScore: null,
        status: "requested",
        slaDueAt: expect.any(Date),
      }),
      select: { id: true },
    });
  });

  it("does nothing when there is no config row", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("does nothing when concierge is disabled", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({ ...MODE_B, enabled: false });
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("does not auto-enqueue for Mode A (user_prompted)", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockResolvedValue({ ...MODE_B, triggerMode: "user_prompted" });
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("does not queue a grounded answer with no confidence score", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, {
      ...BASE_INPUT,
      insufficientKnowledge: false,
      confidence: null,
    });

    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("queues a grounded answer whose confidence is at/below the threshold", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, {
      ...BASE_INPUT,
      insufficientKnowledge: false,
      confidence: 0.5,
    });

    expect(tx.humanReviewRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ confidenceScore: 0.5 }),
      select: { id: true },
    });
  });

  it("does not queue a grounded answer whose confidence is above the threshold", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, {
      ...BASE_INPUT,
      insufficientKnowledge: false,
      confidence: 0.9,
    });

    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("is idempotent — never queues the same message twice", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({ id: "existing" });
    const { service } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.humanReviewRequest.count).not.toHaveBeenCalled();
    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
  });

  it("skips (does not block) once the tenant-wide daily volume cap is reached", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.count.mockResolvedValue(50); // == volumeCapPerDay
    const { service, info } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(tx.humanReviewRequest.count).toHaveBeenCalledWith({
      where: { tenantId: USER.tenantId, createdAt: { gte: expect.any(Date) } },
    });
    expect(tx.humanReviewRequest.create).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "concierge enqueue skipped (volume cap)",
      expect.objectContaining({ cap: 50 }),
    );
  });

  it("swallows errors so a queueing hiccup never breaks the answer", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockRejectedValue(new Error("db down"));
    const { service, error } = makeService(tx);

    await expect(service.enqueueIfTriggered(USER, BASE_INPUT)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "concierge enqueue failed",
      expect.objectContaining({ message: "db down" }),
    );
  });

  it("stringifies a non-Error rejection when logging a failure", async () => {
    const tx = makeTx();
    tx.reviewConfig.findFirst.mockRejectedValue("boom");
    const { service, error } = makeService(tx);

    await service.enqueueIfTriggered(USER, BASE_INPUT);

    expect(error).toHaveBeenCalledWith(
      "concierge enqueue failed",
      expect.objectContaining({ message: "boom" }),
    );
  });
});
