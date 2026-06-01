import { RecommendationService, type RecommendationInput } from "./recommendation.service";
import type { RlsService } from "../auth/rls.service";
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

/** A high-intent rule + a depth rule — enough to exercise selection + the keyword/threshold paths. */
const RULES = [
  {
    trigger: "high_intent",
    enabled: true,
    threshold: null,
    keywords: ["hire", "book"],
    priority: 50,
    consultationTypeKey: "intro_call",
  },
  {
    trigger: "depth",
    enabled: true,
    threshold: 4,
    keywords: [],
    priority: 10,
    consultationTypeKey: null,
  },
];

const INTRO_TYPE = {
  key: "intro_call",
  name: "Intro consultation",
  durationMinutes: 30,
  tidycalLink: "https://tidycal.com/x/intro",
};

function makeTx() {
  return {
    recommendationRule: { findMany: jest.fn() },
    message: { count: jest.fn() },
    consultationType: { findFirst: jest.fn() },
    consultationRecommendation: { create: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>, runImpl?: () => Promise<unknown>) {
  const run = jest.fn(
    runImpl ?? ((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx)),
  );
  const rls = { run } as unknown as RlsService;
  const info = jest.fn();
  const error = jest.fn();
  const logger = { info, error } as unknown as StructuredLogger;
  return { service: new RecommendationService(rls, logger), run, info, error };
}

function input(over: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    conversationId: "conv-1",
    question: "How do I file taxes?",
    answer: "You file annually. [1]",
    citationCount: 1,
    insufficientKnowledge: false,
    ...over,
  };
}

describe("RecommendationService.recommend", () => {
  it("returns null (no DB writes) when no rules are configured", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue([]);
    const { service, run } = makeService(tx);

    expect(await service.recommend(USER, input())).toBeNull();
    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(tx.message.count).not.toHaveBeenCalled();
    expect(tx.consultationRecommendation.create).not.toHaveBeenCalled();
  });

  it("returns null when rules exist but none fire", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue(RULES);
    tx.message.count.mockResolvedValue(1); // below the depth threshold
    const { service } = makeService(tx);

    // Question has no intent keyword and depth is only 1 → nothing fires.
    const result = await service.recommend(USER, input({ question: "What time is it?" }));

    expect(result).toBeNull();
    expect(tx.consultationRecommendation.create).not.toHaveBeenCalled();
  });

  it("persists a recommendation row and returns the DTO when a rule fires", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue(RULES);
    tx.message.count.mockResolvedValue(1);
    tx.consultationType.findFirst.mockResolvedValue(INTRO_TYPE);
    tx.consultationRecommendation.create.mockResolvedValue({ id: "rec-1" });
    const { service } = makeService(tx);

    const result = await service.recommend(USER, input({ question: "Can I hire you?" }));

    expect(result).toEqual({
      id: "rec-1",
      trigger: "high_intent",
      reason: expect.stringContaining("book a consultation"),
      consultationType: INTRO_TYPE,
    });
    // The row is scoped to the acting user + the conversation, stamped with the winning trigger.
    expect(tx.consultationRecommendation.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      conversationId: "conv-1",
      trigger: "high_intent",
    });
  });

  it("derives the depth signal from the conversation's true assistant-turn count", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue(RULES);
    tx.message.count.mockResolvedValue(4); // reaches the depth threshold
    tx.consultationType.findFirst.mockResolvedValue(INTRO_TYPE);
    tx.consultationRecommendation.create.mockResolvedValue({ id: "rec-2" });
    const { service } = makeService(tx);

    const result = await service.recommend(USER, input({ question: "tell me more" }));

    expect(tx.message.count).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", role: "assistant" },
    });
    expect(result?.trigger).toBe("depth");
  });

  it("falls back to the active default type when the rule's configured key is missing", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue([
      { ...RULES[0], consultationTypeKey: "gone" },
    ]);
    tx.message.count.mockResolvedValue(1);
    // First lookup (by key) misses, second (active default) hits.
    tx.consultationType.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(INTRO_TYPE);
    tx.consultationRecommendation.create.mockResolvedValue({ id: "rec-3" });
    const { service } = makeService(tx);

    const result = await service.recommend(USER, input({ question: "book please" }));

    expect(tx.consultationType.findFirst).toHaveBeenCalledTimes(2);
    expect(result?.consultationType).toEqual(INTRO_TYPE);
  });

  it("returns a recommendation with a null type when no active consultation type exists", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue([
      { ...RULES[0], consultationTypeKey: null },
    ]);
    tx.message.count.mockResolvedValue(1);
    tx.consultationType.findFirst.mockResolvedValue(null);
    tx.consultationRecommendation.create.mockResolvedValue({ id: "rec-4" });
    const { service } = makeService(tx);

    const result = await service.recommend(USER, input({ question: "I want to hire" }));

    expect(result).toMatchObject({ id: "rec-4", trigger: "high_intent", consultationType: null });
  });

  it("degrades to null and logs (never throws) when the transaction fails — an answer already streamed", async () => {
    const tx = makeTx();
    const { service, error } = makeService(tx, () => Promise.reject(new Error("db down")));

    const result = await service.recommend(USER, input());

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "consultation recommendation failed",
      expect.objectContaining({ message: "db down" }),
    );
  });

  it("stringifies a non-Error throw when degrading to null", async () => {
    const tx = makeTx();
    const { service, error } = makeService(tx, () => Promise.reject("boom"));

    const result = await service.recommend(USER, input());

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "consultation recommendation failed",
      expect.objectContaining({ message: "boom" }),
    );
  });
});
