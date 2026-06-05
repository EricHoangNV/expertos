import type { PrismaClient } from "@expertos/db";
import { ExpertPortalService } from "./expert-portal.service";
import type { AuthUser } from "../auth/auth.types";
import type { StructuredLogger } from "../observability/logger.service";

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
  firebaseUid: "fb-admin",
  email: "admin@expertos.local",
  role: "admin",
};

const EXPERT_ROW = { id: "33333333-3333-3333-3333-333333333333", displayName: "Dr. Expert" };
const OTHER_EXPERT_ID = "44444444-4444-4444-4444-444444444444";

function makeTx() {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    expert: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    consultationRecommendation: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    consultation: { groupBy: jest.fn().mockResolvedValue([]) },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as StructuredLogger;
  return { service: new ExpertPortalService(prisma, logger), tx };
}

describe("ExpertPortalService.conversions", () => {
  it("scopes a non-admin to their own linked expert and aggregates the funnel", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    tx.consultationRecommendation.groupBy.mockResolvedValue([
      { trigger: "topic", response: "book", _count: { _all: 3 } },
      { trigger: "topic", response: "pending", _count: { _all: 2 } },
      { trigger: "depth", response: "maybe_later", _count: { _all: 1 } },
    ]);
    tx.consultation.groupBy.mockResolvedValue([
      { status: "booked", _count: { _all: 2 }, _sum: { amountCents: 30000 } },
      { status: "canceled", _count: { _all: 1 }, _sum: { amountCents: 15000 } },
    ]);
    const { service } = makeService(tx);

    const result = await service.conversions(EXPERT_USER, null);

    // resolved by own userId + tenant, not the (ignored) requested id.
    expect(tx.expert.findFirst).toHaveBeenCalledWith({
      where: { userId: EXPERT_USER.id, tenantId: EXPERT_USER.tenantId },
      select: { id: true, displayName: true },
    });
    expect(result.expert).toEqual(EXPERT_ROW);
    expect(result.recommendationCount).toBe(6);
    expect(result.byTrigger).toEqual({ topic: 5, depth: 1, low_confidence: 0, high_intent: 0 });
    expect(result.byResponse).toEqual({ pending: 2, book: 3, maybe_later: 1, ask_another: 0 });
    expect(result.byConsultationStatus.booked).toBe(2);
    expect(result.byConsultationStatus.canceled).toBe(1);
    // revenue counts booked-and-beyond only — canceled is excluded.
    expect(result.revenueCents).toBe(30000);
  });

  it("pins the aggregate queries to the resolved expert's voice", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    const { service } = makeService(tx);

    await service.conversions(EXPERT_USER, null);

    expect(tx.consultationRecommendation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: EXPERT_USER.tenantId, conversation: { expertId: EXPERT_ROW.id } },
      }),
    );
    expect(tx.consultation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: EXPERT_USER.tenantId,
          recommendations: { some: { conversation: { expertId: EXPERT_ROW.id } } },
        },
      }),
    );
  });

  it("maps the recent feed, carrying or nulling the linked consultation", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    const created = new Date("2026-05-20T08:00:00.000Z");
    tx.consultationRecommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        trigger: "high_intent",
        response: "book",
        createdAt: created,
        consultation: { status: "booked", amountCents: 30000 },
      },
      {
        id: "rec-2",
        trigger: "topic",
        response: "maybe_later",
        createdAt: created,
        consultation: null,
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.conversions(EXPERT_USER, null);

    expect(result.recent).toEqual([
      {
        recommendationId: "rec-1",
        trigger: "high_intent",
        response: "book",
        consultationStatus: "booked",
        amountCents: 30000,
        createdAt: created.toISOString(),
      },
      {
        recommendationId: "rec-2",
        trigger: "topic",
        response: "maybe_later",
        consultationStatus: null,
        amountCents: null,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("tolerates a null _sum.amountCents on a booked group", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    tx.consultation.groupBy.mockResolvedValue([
      { status: "confirmed", _count: { _all: 1 }, _sum: { amountCents: null } },
    ]);
    const { service } = makeService(tx);

    const result = await service.conversions(EXPERT_USER, null);

    expect(result.byConsultationStatus.confirmed).toBe(1);
    expect(result.revenueCents).toBe(0);
  });

  it("returns a zeroed empty result for an unlinked expert without aggregating", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    const result = await service.conversions(EXPERT_USER, null);

    expect(result.expert).toBeNull();
    expect(result.recommendationCount).toBe(0);
    expect(result.byTrigger).toEqual({ topic: 0, depth: 0, low_confidence: 0, high_intent: 0 });
    expect(result.byResponse).toEqual({ pending: 0, book: 0, maybe_later: 0, ask_another: 0 });
    expect(result.revenueCents).toBe(0);
    expect(result.recent).toEqual([]);
    expect(tx.consultationRecommendation.groupBy).not.toHaveBeenCalled();
    expect(tx.consultation.groupBy).not.toHaveBeenCalled();
  });

  it("resolves an admin to the requested expert (by id + tenant)", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue({ id: OTHER_EXPERT_ID, displayName: "Other" });
    const { service } = makeService(tx);

    const result = await service.conversions(ADMIN_USER, OTHER_EXPERT_ID);

    expect(tx.expert.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER_EXPERT_ID, tenantId: ADMIN_USER.tenantId },
      select: { id: true, displayName: true },
    });
    expect(result.expert).toEqual({ id: OTHER_EXPERT_ID, displayName: "Other" });
  });

  it("returns empty for an admin who targets no expert (never widens to the tenant)", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.conversions(ADMIN_USER, null);

    expect(result.expert).toBeNull();
    expect(tx.expert.findFirst).not.toHaveBeenCalled();
    expect(tx.consultationRecommendation.groupBy).not.toHaveBeenCalled();
  });

  it("runs reads in an elevated (is_admin) RLS context pinned to the caller's tenant", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.conversions(EXPERT_USER, null);

    const calls = tx.$executeRawUnsafe.mock.calls;
    expect(calls).toContainEqual([
      "SELECT set_config('app.current_tenant_id', $1, true)",
      EXPERT_USER.tenantId,
    ]);
    expect(calls).toContainEqual(["SELECT set_config('app.is_admin', $1, true)", "true"]);
  });
});

describe("ExpertPortalService.answers", () => {
  const QUERY = { limit: 50, offset: 0 };

  it("scopes a non-admin to their own expert and passes the SQL args", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    const created = new Date("2026-05-21T09:00:00.000Z");
    tx.$queryRawUnsafe.mockResolvedValue([
      {
        message_id: "msg-1",
        conversation_id: "conv-1",
        question: "Is this deductible?",
        answer: "Yes, under section 12.",
        model: "echo-dev",
        confidence: 0.81,
        insufficient_knowledge: false,
        helpful: true,
        feedback_reason: null,
        created_at: created,
      },
    ]);
    const { service } = makeService(tx);

    const result = await service.answers(EXPERT_USER, null, QUERY);

    const call = tx.$queryRawUnsafe.mock.calls[0];
    expect(typeof call[0]).toBe("string");
    expect(call[1]).toBe(EXPERT_USER.tenantId); // $1 = tenantId
    expect(call[2]).toBe(EXPERT_ROW.id); // $2 = expertId
    expect(call[3]).toBe(50); // $3 = limit
    expect(call[4]).toBe(0); // $4 = offset
    expect(result).toEqual([
      {
        messageId: "msg-1",
        conversationId: "conv-1",
        question: "Is this deductible?",
        answer: "Yes, under section 12.",
        model: "echo-dev",
        confidence: 0.81,
        insufficientKnowledge: false,
        helpful: true,
        feedbackReason: null,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("preserves nulls (no question / model / confidence / feedback) and the insufficient flag", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    const created = new Date("2026-05-22T09:00:00.000Z");
    tx.$queryRawUnsafe.mockResolvedValue([
      {
        message_id: "msg-2",
        conversation_id: "conv-2",
        question: null,
        answer: "I don't have enough information to answer that.",
        model: null,
        confidence: null,
        insufficient_knowledge: true,
        helpful: null,
        feedback_reason: null,
        created_at: created,
      },
    ]);
    const { service } = makeService(tx);

    const [row] = await service.answers(EXPERT_USER, null, QUERY);

    expect(row.question).toBeNull();
    expect(row.model).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.helpful).toBeNull();
    expect(row.insufficientKnowledge).toBe(true);
  });

  it("returns an empty page for an unlinked expert without querying", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    expect(await service.answers(EXPERT_USER, null, QUERY)).toEqual([]);
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("passes an admin's requested expert + pagination through to the query", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue({ id: OTHER_EXPERT_ID, displayName: "Other" });
    const { service } = makeService(tx);

    await service.answers(ADMIN_USER, OTHER_EXPERT_ID, { limit: 10, offset: 20 });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    expect(call[2]).toBe(OTHER_EXPERT_ID);
    expect(call[3]).toBe(10);
    expect(call[4]).toBe(20);
  });
});

describe("ExpertPortalService calendar settings (M16)", () => {
  const prevKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = prevKey;
  });

  it("returns the caller's own settings (token never echoed)", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW); // resolveExpert → own row
    tx.expert.findUnique.mockResolvedValue({
      tidycalApiTokenEnc: "iv:tag:ct",
      tidycalApiTokenLast4: "1234",
      tidycalLink: "https://tidycal.com/e",
    });
    const { service } = makeService(tx);

    const dto = await service.getCalendarSettings(EXPERT_USER, null);

    expect(tx.expert.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: EXPERT_USER.id, tenantId: EXPERT_USER.tenantId } }),
    );
    expect(dto).toEqual({
      apiTokenConfigured: true,
      apiTokenLast4: "1234",
      tidycalLink: "https://tidycal.com/e",
    });
  });

  it("returns the empty view when the caller has no linked expert", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    expect(await service.getCalendarSettings(EXPERT_USER, null)).toEqual({
      apiTokenConfigured: false,
      apiTokenLast4: null,
      tidycalLink: null,
    });
    expect(tx.expert.findUnique).not.toHaveBeenCalled();
  });

  it("encrypts + stores the token on update, scoped to the caller's own expert row", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(EXPERT_ROW);
    tx.expert.update.mockResolvedValue({
      tidycalApiTokenEnc: "iv:tag:ct",
      tidycalApiTokenLast4: "6789",
      tidycalLink: null,
    });
    const { service } = makeService(tx);

    const dto = await service.updateCalendarSettings(EXPERT_USER, null, { apiToken: "tok_456789" });

    const updateArg = tx.expert.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: EXPERT_ROW.id });
    expect(updateArg.data.tidycalApiTokenEnc).toEqual(expect.any(String));
    expect(updateArg.data.tidycalApiTokenEnc).not.toContain("tok_456789"); // encrypted, not plaintext
    expect(updateArg.data.tidycalApiTokenLast4).toBe("6789");
    expect(dto.apiTokenConfigured).toBe(true);
  });

  it("404s an update when the caller has no expert profile", async () => {
    const tx = makeTx();
    tx.expert.findFirst.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.updateCalendarSettings(EXPERT_USER, null, { apiToken: "x" })).rejects.toThrow(
      /no expert profile/,
    );
  });
});
