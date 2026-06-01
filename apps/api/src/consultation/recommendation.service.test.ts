import { NotFoundException } from "@nestjs/common";
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
    recommendationRule: { findMany: jest.fn(), findUnique: jest.fn() },
    message: { count: jest.fn() },
    consultationType: { findFirst: jest.fn() },
    consultationRecommendation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    consultation: { create: jest.fn(), findUnique: jest.fn() },
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

/** The booking-time consultation-type shape `resolveBookableType` selects (id + priceCents + link). */
const BOOKABLE_TYPE = {
  id: "type-1",
  priceCents: 5000,
  tidycalLink: "https://tidycal.com/x/intro",
};

describe("RecommendationService.respond", () => {
  it("404s when the recommendation isn't the acting user's (RLS-invisible → null)", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(service.respond(USER, "rec-x", { response: "book" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.consultationRecommendation.update).not.toHaveBeenCalled();
  });

  it("records 'maybe_later' without creating a consultation", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      trigger: "depth",
      consultationId: null,
    });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-1", { response: "maybe_later" });

    expect(result).toEqual({ id: "rec-1", response: "maybe_later", booking: null });
    expect(tx.consultationRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { response: "maybe_later" },
    });
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("records 'ask_another' without creating a consultation", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-2",
      trigger: "topic",
      consultationId: null,
    });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-2", { response: "ask_another" });

    expect(result).toEqual({ id: "rec-2", response: "ask_another", booking: null });
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("on 'book' resolves the rule's type, creates + links a consultation, returns the link", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-3",
      trigger: "high_intent",
      consultationId: null,
    });
    tx.recommendationRule.findUnique.mockResolvedValue({ consultationTypeKey: "intro_call" });
    tx.consultationType.findFirst.mockResolvedValue(BOOKABLE_TYPE);
    tx.consultation.create.mockResolvedValue({ id: "cons-1" });
    const { service, info } = makeService(tx);

    const result = await service.respond(USER, "rec-3", { response: "book" });

    expect(result).toEqual({
      id: "rec-3",
      response: "book",
      booking: { consultationId: "cons-1", tidycalLink: "https://tidycal.com/x/intro" },
    });
    // Consultation is scoped to the acting user and stamped with the type + its price.
    expect(tx.consultation.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      typeId: "type-1",
      status: "recommended",
      amountCents: 5000,
    });
    // The recommendation is linked back to the consultation (the funnel-attribution join).
    expect(tx.consultationRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-3" },
      data: { consultationId: "cons-1" },
    });
    expect(info).toHaveBeenCalledWith("consultation booking opened", expect.any(Object));
  });

  it("is idempotent on 'book' — reuses an existing consultation instead of creating a duplicate", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-4",
      trigger: "high_intent",
      consultationId: "cons-existing",
    });
    tx.consultation.findUnique.mockResolvedValue({
      id: "cons-existing",
      type: { tidycalLink: "https://tidycal.com/x/intro" },
    });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-4", { response: "book" });

    expect(result.booking).toEqual({
      consultationId: "cons-existing",
      tidycalLink: "https://tidycal.com/x/intro",
    });
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("reuses an existing consultation with no type → null booking link", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-4b",
      trigger: "high_intent",
      consultationId: "cons-typeless",
    });
    tx.consultation.findUnique.mockResolvedValue({ id: "cons-typeless", type: null });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-4b", { response: "book" });

    expect(result.booking).toEqual({ consultationId: "cons-typeless", tidycalLink: null });
    expect(tx.consultation.create).not.toHaveBeenCalled();
  });

  it("creates a fresh consultation when the linked one is gone (SetNull'd) and recreates the link", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-5",
      trigger: "high_intent",
      consultationId: "cons-gone",
    });
    tx.consultation.findUnique.mockResolvedValue(null); // the linked consultation no longer exists
    tx.recommendationRule.findUnique.mockResolvedValue({ consultationTypeKey: "intro_call" });
    tx.consultationType.findFirst.mockResolvedValue(BOOKABLE_TYPE);
    tx.consultation.create.mockResolvedValue({ id: "cons-2" });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-5", { response: "book" });

    expect(tx.consultation.create).toHaveBeenCalled();
    expect(result.booking?.consultationId).toBe("cons-2");
  });

  it("falls back to the active default type when the rule's key is missing", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-6",
      trigger: "high_intent",
      consultationId: null,
    });
    tx.recommendationRule.findUnique.mockResolvedValue({ consultationTypeKey: "gone" });
    // First lookup (by key) misses, second (active default) hits.
    tx.consultationType.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(BOOKABLE_TYPE);
    tx.consultation.create.mockResolvedValue({ id: "cons-3" });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-6", { response: "book" });

    expect(tx.consultationType.findFirst).toHaveBeenCalledTimes(2);
    expect(result.booking?.consultationId).toBe("cons-3");
  });

  it("books with a null type + null link when no active consultation type exists", async () => {
    const tx = makeTx();
    tx.consultationRecommendation.findUnique.mockResolvedValue({
      id: "rec-7",
      trigger: "high_intent",
      consultationId: null,
    });
    tx.recommendationRule.findUnique.mockResolvedValue(null); // no rule → fall through to default
    tx.consultationType.findFirst.mockResolvedValue(null); // no active type at all
    tx.consultation.create.mockResolvedValue({ id: "cons-4" });
    const { service } = makeService(tx);

    const result = await service.respond(USER, "rec-7", { response: "book" });

    expect(tx.consultation.create.mock.calls[0][0].data).toMatchObject({
      typeId: null,
      amountCents: null,
    });
    expect(result.booking).toEqual({ consultationId: "cons-4", tidycalLink: null });
  });
});
