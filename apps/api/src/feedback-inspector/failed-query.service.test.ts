import { FailedQueryService } from "./failed-query.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb-admin",
  email: "admin@expertos.local",
  displayName: "Admin",
  role: "admin",
  locale: "en",
};

function makeTx() {
  return { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new FailedQueryService(rls), run };
}

describe("FailedQueryService.list", () => {
  it("maps raw rows into DTOs (question, reason, confidence, insufficient flag, ISO date)", async () => {
    const tx = makeTx();
    const created = new Date("2026-05-30T10:00:00.000Z");
    tx.$queryRawUnsafe.mockResolvedValue([
      {
        feedback_id: "fb-1",
        message_id: "msg-1",
        conversation_id: "conv-1",
        question: "How do I file taxes?",
        answer: "You file by April 15.",
        reason: "Too vague",
        model: "echo-dev",
        confidence: 0.42,
        insufficient_knowledge: false,
        created_at: created,
      },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result).toEqual([
      {
        feedbackId: "fb-1",
        messageId: "msg-1",
        conversationId: "conv-1",
        question: "How do I file taxes?",
        answer: "You file by April 15.",
        reason: "Too vague",
        model: "echo-dev",
        confidence: 0.42,
        insufficientKnowledge: false,
        createdAt: created.toISOString(),
      },
    ]);
  });

  it("preserves nulls (no question / no reason / no model / no confidence) and the insufficient flag", async () => {
    const tx = makeTx();
    const created = new Date("2026-06-01T00:00:00.000Z");
    tx.$queryRawUnsafe.mockResolvedValue([
      {
        feedback_id: "fb-2",
        message_id: "msg-2",
        conversation_id: "conv-2",
        question: null,
        answer: "I don't have enough information to answer that.",
        reason: null,
        model: null,
        confidence: null,
        insufficient_knowledge: true,
        created_at: created,
      },
    ]);
    const { service } = makeService(tx);

    const [row] = await service.list(ADMIN, { limit: 50, offset: 0 });

    expect(row.question).toBeNull();
    expect(row.reason).toBeNull();
    expect(row.model).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.insufficientKnowledge).toBe(true);
  });

  it("passes limit and offset through as the parameterized SQL args", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await service.list(ADMIN, { limit: 10, offset: 20 });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    expect(typeof call[0]).toBe("string"); // the SQL is the first argument
    expect(call[1]).toBe(10); // $1 = limit
    expect(call[2]).toBe(20); // $2 = offset
  });

  it("returns an empty list when no answers were rated unhelpful", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    expect(await service.list(ADMIN, { limit: 50, offset: 0 })).toEqual([]);
  });
});
