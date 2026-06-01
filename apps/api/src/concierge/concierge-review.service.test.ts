import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@expertos/db";
import { ConciergeReviewService } from "./concierge-review.service";
import type { ConciergeFlywheelService } from "./concierge-flywheel.service";
import type { ConciergeDeliveryService } from "./concierge-delivery.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";

const EXPERT_USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb-expert",
  email: "expert@expertos.local",
  displayName: "Dr. Expert",
  role: "expert",
  locale: "en",
};

const ADMIN_USER: AuthUser = {
  ...EXPERT_USER,
  id: "99999999-9999-9999-9999-999999999999",
  role: "admin",
};

const EXPERT_ROW = { id: "33333333-3333-3333-3333-333333333333" };
const OTHER_EXPERT_ID = "44444444-4444-4444-4444-444444444444";

const REQUEST_ROW = {
  id: "55555555-5555-5555-5555-555555555555",
  userId: "88888888-8888-8888-8888-888888888888",
  messageId: "66666666-6666-6666-6666-666666666666",
  triggerMode: "auto_silent",
  visibility: "silent",
  confidenceScore: null,
  status: "requested",
  slaDueAt: new Date("2026-06-02T00:00:00.000Z"),
  claimedAt: null,
  answeredAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  message: {
    content: "The original AI answer [1].",
    conversationId: "77777777-7777-7777-7777-777777777777",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  },
  responses: [],
};

function makeTx() {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    expert: { findFirst: jest.fn().mockResolvedValue(EXPERT_ROW) },
    humanReviewRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(REQUEST_ROW),
      update: jest.fn().mockResolvedValue(undefined),
    },
    message: { findFirst: jest.fn().mockResolvedValue({ content: "the question?" }) },
    reviewResponse: {
      create: jest.fn().mockResolvedValue({
        id: "resp-1",
        reviewerId: EXPERT_USER.id,
        verdict: "great",
        originalAnswer: REQUEST_ROW.message.content,
        revisedAnswer: "An improved answer.",
        edited: true,
        notes: null,
        deliveredToUser: false,
        createdAt: new Date("2026-06-01T01:00:00.000Z"),
      }),
    },
    consultationType: {
      findFirst: jest.fn().mockResolvedValue({
        id: "ct-1",
        key: "deep-dive",
        priceCents: 19900,
        tidycalLink: "https://tidycal.com/expert/deep-dive",
      }),
    },
    consultation: {
      create: jest.fn().mockResolvedValue({ id: "cons-1" }),
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  const logger = { info: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
  const flywheel = {
    applyReviewOutcome: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ConciergeFlywheelService>;
  const delivery = {
    deliver: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ConciergeDeliveryService>;
  return {
    service: new ConciergeReviewService(prisma, logger, flywheel, delivery),
    tx,
    flywheel,
    delivery,
  };
}

describe("ConciergeReviewService.list", () => {
  it("scopes a non-admin to their own voice and maps queue items", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findMany.mockResolvedValue([
      { ...REQUEST_ROW, responses: [{ id: "r", verdict: "good" }, { id: "r2", verdict: "bad" }] },
      // an answered item with no SLA but claimed/answered timestamps + no responses (other branches).
      {
        ...REQUEST_ROW,
        id: "answered-1",
        status: "answered",
        slaDueAt: null,
        claimedAt: new Date("2026-06-01T02:00:00.000Z"),
        answeredAt: new Date("2026-06-01T03:00:00.000Z"),
        responses: [],
      },
    ]);
    const { service } = makeService(tx);

    const items = await service.list(EXPERT_USER, OTHER_EXPERT_ID, { limit: 50, offset: 0 });

    // resolved by own userId + tenant (the requested id is ignored for a non-admin).
    expect(tx.expert.findFirst).toHaveBeenCalledWith({
      where: { userId: EXPERT_USER.id, tenantId: EXPERT_USER.tenantId },
      select: { id: true },
    });
    expect(tx.humanReviewRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: EXPERT_USER.tenantId,
          message: { conversation: { expertId: EXPERT_ROW.id } },
        },
        take: 50,
        skip: 0,
      }),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: REQUEST_ROW.id,
      conversationId: REQUEST_ROW.message.conversationId,
      answerPreview: REQUEST_ROW.message.content,
      latestVerdict: "good",
      responseCount: 2,
      slaDueAt: "2026-06-02T00:00:00.000Z",
      claimedAt: null,
    });
    expect(items[1]).toMatchObject({
      id: "answered-1",
      slaDueAt: null,
      claimedAt: "2026-06-01T02:00:00.000Z",
      answeredAt: "2026-06-01T03:00:00.000Z",
      latestVerdict: null,
      responseCount: 0,
    });
  });

  it("narrows by status when one is supplied", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.list(EXPERT_USER, null, { status: "requested", limit: 10, offset: 5 });

    expect(tx.humanReviewRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: EXPERT_USER.tenantId,
          message: { conversation: { expertId: EXPERT_ROW.id } },
          status: "requested",
        },
        take: 10,
        skip: 5,
      }),
    );
  });

  it("returns an empty queue (no query) for an unlinked expert", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const items = await service.list(EXPERT_USER, null, { limit: 50, offset: 0 });

    expect(items).toEqual([]);
    expect(tx.humanReviewRequest.findMany).not.toHaveBeenCalled();
  });

  it("lets an admin target a requested expert", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.list(ADMIN_USER, OTHER_EXPERT_ID, { limit: 50, offset: 0 });

    expect(tx.expert.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER_EXPERT_ID, tenantId: ADMIN_USER.tenantId },
      select: { id: true },
    });
  });

  it("never widens to the tenant when an admin supplies no expert", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const items = await service.list(ADMIN_USER, null, { limit: 50, offset: 0 });

    expect(items).toEqual([]);
    expect(tx.expert.findFirst).not.toHaveBeenCalled();
    expect(tx.humanReviewRequest.findMany).not.toHaveBeenCalled();
  });
});

describe("ConciergeReviewService.get", () => {
  it("returns full detail with the prompting question and responses", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({
      ...REQUEST_ROW,
      responses: [
        {
          id: "resp-1",
          reviewerId: EXPERT_USER.id,
          verdict: "great",
          originalAnswer: REQUEST_ROW.message.content,
          revisedAnswer: "Better.",
          edited: true,
          notes: "tightened it",
          deliveredToUser: false,
          createdAt: new Date("2026-06-01T01:00:00.000Z"),
        },
      ],
    });
    const { service } = makeService(tx);

    const detail = await service.get(EXPERT_USER, null, REQUEST_ROW.id);

    expect(tx.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: REQUEST_ROW.message.conversationId,
          role: "user",
          createdAt: { lte: REQUEST_ROW.message.createdAt },
        },
      }),
    );
    expect(detail).toMatchObject({
      id: REQUEST_ROW.id,
      answer: REQUEST_ROW.message.content,
      question: "the question?",
      responses: [{ id: "resp-1", verdict: "great", edited: true }],
    });
    expect(detail).not.toHaveProperty("answerPreview");
  });

  it("returns null question when no prompting message exists", async () => {
    const tx = makeTx();
    tx.message.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const detail = await service.get(EXPERT_USER, null, REQUEST_ROW.id);

    expect(detail.question).toBeNull();
  });

  it("maps an answered request's claimed/answered timestamps and a null SLA", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({
      ...REQUEST_ROW,
      status: "answered",
      slaDueAt: null,
      claimedAt: new Date("2026-06-01T02:00:00.000Z"),
      answeredAt: new Date("2026-06-01T03:00:00.000Z"),
      responses: [],
    });
    const { service } = makeService(tx);

    const detail = await service.get(EXPERT_USER, null, REQUEST_ROW.id);

    expect(detail).toMatchObject({
      slaDueAt: null,
      claimedAt: "2026-06-01T02:00:00.000Z",
      answeredAt: "2026-06-01T03:00:00.000Z",
      responses: [],
    });
  });

  it("404s when the request is not in the reviewer's voice", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.get(EXPERT_USER, null, REQUEST_ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("404s when no expert resolves", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.get(EXPERT_USER, null, REQUEST_ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.humanReviewRequest.findFirst).not.toHaveBeenCalled();
  });
});

describe("ConciergeReviewService.respond", () => {
  it("records the verdict + edit and moves the request to answered", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "great",
      revisedAnswer: "An improved answer.",
      notes: null,
    });

    expect(tx.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: EXPERT_USER.tenantId,
          reviewRequestId: REQUEST_ROW.id,
          reviewerId: EXPERT_USER.id,
          verdict: "great",
          originalAnswer: REQUEST_ROW.message.content,
          revisedAnswer: "An improved answer.",
          edited: true,
          notes: null,
        }),
      }),
    );
    expect(tx.humanReviewRequest.update).toHaveBeenCalledWith({
      where: { id: REQUEST_ROW.id },
      data: { status: "answered", answeredAt: expect.any(Date), assigneeId: EXPERT_USER.id },
    });
    expect(result).toMatchObject({ id: "resp-1", verdict: "great", edited: true });
  });

  it("feeds the recorded verdict into the flywheel after the verdict commits", async () => {
    const tx = makeTx();
    const { service, flywheel } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "great",
      revisedAnswer: "An improved answer.",
      notes: null,
    });

    expect(flywheel.applyReviewOutcome).toHaveBeenCalledWith({
      reviewRequestId: REQUEST_ROW.id,
      tenantId: EXPERT_USER.tenantId,
      verdict: "great",
      improvedAnswer: "An improved answer.",
      edited: true,
    });
  });

  it("passes the original answer as the improved answer for a verdict-only response", async () => {
    const tx = makeTx();
    const { service, flywheel } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "bad",
      revisedAnswer: null,
      notes: null,
    });

    expect(flywheel.applyReviewOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "bad",
        improvedAnswer: REQUEST_ROW.message.content,
        edited: false,
      }),
    );
  });

  it("async-delivers the refined answer after the verdict commits (M9.3)", async () => {
    const tx = makeTx();
    const { service, delivery } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "great",
      revisedAnswer: "An improved answer.",
      notes: null,
    });

    expect(delivery.deliver).toHaveBeenCalledWith({
      reviewRequestId: REQUEST_ROW.id,
      responseId: "resp-1",
      tenantId: EXPERT_USER.tenantId,
      revisedAnswer: "An improved answer.",
      edited: true,
    });
  });

  it("hands delivery a null revision for a verdict-only response (it stays silent)", async () => {
    const tx = makeTx();
    const { service, delivery } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "good",
      revisedAnswer: null,
      notes: null,
    });

    expect(delivery.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ revisedAnswer: null, edited: false }),
    );
  });

  it("does not run the flywheel or delivery when the verdict is rejected (409)", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({ ...REQUEST_ROW, status: "answered" });
    const { service, flywheel, delivery } = makeService(tx);

    await expect(
      service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
        verdict: "good",
        revisedAnswer: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(flywheel.applyReviewOutcome).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("marks edited:false for a verdict-only response (no revision)", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "good",
      revisedAnswer: null,
      notes: null,
    });

    expect(tx.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ edited: false, revisedAnswer: null }) }),
    );
  });

  it("marks edited:false when the revision equals the original answer", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
      verdict: "good",
      revisedAnswer: REQUEST_ROW.message.content,
      notes: null,
    });

    expect(tx.reviewResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ edited: false }) }),
    );
  });

  it("409s when the request is already answered", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({ ...REQUEST_ROW, status: "answered" });
    const { service } = makeService(tx);

    await expect(
      service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
        verdict: "good",
        revisedAnswer: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.reviewResponse.create).not.toHaveBeenCalled();
  });

  it("404s when the request is not in the reviewer's voice", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.respond(EXPERT_USER, null, REQUEST_ROW.id, {
        verdict: "good",
        revisedAnswer: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ConciergeReviewService.escalate", () => {
  it("opens a recommended consultation for the asking user and escalates the request", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.escalate(EXPERT_USER, null, REQUEST_ROW.id, {
      consultationTypeKey: "deep-dive",
      notes: null,
    });

    // type resolved by the requested key (active).
    expect(tx.consultationType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "deep-dive", active: true } }),
    );
    // consultation opened for the request's user (not the reviewer), priced from the type.
    expect(tx.consultation.create).toHaveBeenCalledWith({
      data: {
        tenantId: EXPERT_USER.tenantId,
        userId: REQUEST_ROW.userId,
        typeId: "ct-1",
        status: "recommended",
        amountCents: 19900,
      },
      select: { id: true },
    });
    expect(tx.humanReviewRequest.update).toHaveBeenCalledWith({
      where: { id: REQUEST_ROW.id },
      data: { status: "escalated", assigneeId: EXPERT_USER.id },
    });
    expect(result).toEqual({
      reviewRequestId: REQUEST_ROW.id,
      status: "escalated",
      consultationId: "cons-1",
      consultationTypeKey: "deep-dive",
      tidycalLink: "https://tidycal.com/expert/deep-dive",
    });
  });

  it("falls back to the active default type when no key is supplied", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.escalate(EXPERT_USER, null, REQUEST_ROW.id, {
      consultationTypeKey: null,
      notes: null,
    });

    expect(tx.consultationType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    );
  });

  it("opens an untyped consultation when no active type exists", async () => {
    const tx = makeTx();
    tx.consultationType.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const result = await service.escalate(EXPERT_USER, null, REQUEST_ROW.id, {
      consultationTypeKey: null,
      notes: null,
    });

    expect(tx.consultation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ typeId: null, amountCents: null }) }),
    );
    expect(result).toMatchObject({ consultationTypeKey: null, tidycalLink: null });
  });

  it("409s when the request is already answered (no consultation opened)", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue({ ...REQUEST_ROW, status: "answered" });
    const { service } = makeService(tx);

    await expect(
      service.escalate(EXPERT_USER, null, REQUEST_ROW.id, { consultationTypeKey: null, notes: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("404s when the request is not in the reviewer's voice", async () => {
    const tx = makeTx();
    tx.humanReviewRequest.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.escalate(EXPERT_USER, null, REQUEST_ROW.id, { consultationTypeKey: null, notes: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
