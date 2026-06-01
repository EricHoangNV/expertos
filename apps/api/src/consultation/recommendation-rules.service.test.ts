import { BadRequestException } from "@nestjs/common";
import type { RecommendationRuleUpdateInput } from "@expertos/shared";
import { RecommendationRulesService } from "./recommendation-rules.service";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "admin@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

function makeTx() {
  return {
    recommendationRule: { findMany: jest.fn(), upsert: jest.fn() },
    consultationType: { findMany: jest.fn(), findUnique: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  return { service: new RecommendationRulesService(rls), run };
}

/** A fully-specified update body (the schema applies the `null`/`[]`/`0` defaults before this point). */
function input(over: Partial<RecommendationRuleUpdateInput> = {}): RecommendationRuleUpdateInput {
  return { enabled: true, threshold: null, keywords: [], priority: 0, consultationTypeKey: null, ...over };
}

/** Mirror back whatever the service writes, so the test can assert the persisted shape. */
function echoUpsert(tx: ReturnType<typeof makeTx>, trigger: string) {
  tx.recommendationRule.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({
      trigger,
      enabled: create.enabled,
      threshold: create.threshold,
      keywords: create.keywords,
      priority: create.priority,
      consultationTypeKey: create.consultationTypeKey,
    }),
  );
}

describe("RecommendationRulesService.getRules", () => {
  it("maps rules (highest priority first) + consultation types under the actor's RLS context", async () => {
    const tx = makeTx();
    tx.recommendationRule.findMany.mockResolvedValue([
      {
        trigger: "high_intent",
        enabled: true,
        threshold: null,
        keywords: ["book", "hire"],
        priority: 50,
        consultationTypeKey: "intro_call",
      },
      {
        trigger: "depth",
        enabled: false,
        threshold: 4,
        keywords: [],
        priority: 10,
        consultationTypeKey: null,
      },
    ]);
    tx.consultationType.findMany.mockResolvedValue([
      { key: "intro_call", name: "Intro consultation", active: true },
    ]);
    const { service, run } = makeService(tx);

    const result = await service.getRules(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result.consultationTypes).toEqual([
      { key: "intro_call", name: "Intro consultation", active: true },
    ]);
    // `kind` is derived from the trigger: keyword vs threshold.
    expect(result.rules[0]).toEqual({
      trigger: "high_intent",
      enabled: true,
      threshold: null,
      keywords: ["book", "hire"],
      priority: 50,
      consultationTypeKey: "intro_call",
      kind: "keyword",
    });
    expect(result.rules[1].kind).toBe("threshold");
  });
});

describe("RecommendationRulesService.updateRule", () => {
  it("keeps a keyword rule's keywords and forces its threshold to null", async () => {
    const tx = makeTx();
    echoUpsert(tx, "topic");
    const { service } = makeService(tx);

    const result = await service.updateRule(
      ADMIN,
      "topic",
      input({ keywords: ["legal", "tax"], threshold: 99, consultationTypeKey: null }),
    );

    const args = tx.recommendationRule.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ trigger: "topic" });
    expect(args.create).toMatchObject({ keywords: ["legal", "tax"], threshold: null });
    expect(args.update).toMatchObject({ keywords: ["legal", "tax"], threshold: null });
    expect(result).toMatchObject({ trigger: "topic", keywords: ["legal", "tax"], threshold: null, kind: "keyword" });
  });

  it("keeps a threshold rule's threshold and forces its keywords to empty", async () => {
    const tx = makeTx();
    echoUpsert(tx, "depth");
    const { service } = makeService(tx);

    const result = await service.updateRule(
      ADMIN,
      "depth",
      input({ threshold: 4, keywords: ["ignored"], priority: 10 }),
    );

    expect(result).toMatchObject({ trigger: "depth", threshold: 4, keywords: [], priority: 10, kind: "threshold" });
  });

  it("allows low_confidence with a zero threshold (0 citations is still 'low')", async () => {
    const tx = makeTx();
    echoUpsert(tx, "low_confidence");
    const { service } = makeService(tx);

    const result = await service.updateRule(ADMIN, "low_confidence", input({ threshold: 0 }));

    expect(result.threshold).toBe(0);
    expect(result.keywords).toEqual([]);
  });

  it("allows a disabled keyword rule with no keywords (it never fires either way)", async () => {
    const tx = makeTx();
    echoUpsert(tx, "high_intent");
    const { service } = makeService(tx);

    const result = await service.updateRule(ADMIN, "high_intent", input({ enabled: false, keywords: [] }));

    expect(result.enabled).toBe(false);
  });

  it("rejects an enabled keyword rule with no keywords", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.updateRule(ADMIN, "topic", input({ enabled: true, keywords: [] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.recommendationRule.upsert).not.toHaveBeenCalled();
  });

  it("rejects an enabled threshold rule with a null threshold", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.updateRule(ADMIN, "low_confidence", input({ enabled: true, threshold: null })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.recommendationRule.upsert).not.toHaveBeenCalled();
  });

  it("rejects an enabled depth rule with a threshold below 1", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.updateRule(ADMIN, "depth", input({ enabled: true, threshold: 0 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.recommendationRule.upsert).not.toHaveBeenCalled();
  });

  it("validates a non-null consultationTypeKey exists before writing", async () => {
    const tx = makeTx();
    tx.consultationType.findUnique.mockResolvedValue(null);
    const { service } = makeService(tx);

    await expect(
      service.updateRule(ADMIN, "topic", input({ keywords: ["legal"], consultationTypeKey: "ghost" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.recommendationRule.upsert).not.toHaveBeenCalled();
  });

  it("persists a valid consultationTypeKey that resolves to a real type", async () => {
    const tx = makeTx();
    tx.consultationType.findUnique.mockResolvedValue({ key: "intro_call" });
    echoUpsert(tx, "topic");
    const { service } = makeService(tx);

    const result = await service.updateRule(
      ADMIN,
      "topic",
      input({ keywords: ["legal"], consultationTypeKey: "intro_call" }),
    );

    expect(tx.consultationType.findUnique).toHaveBeenCalledWith({
      where: { key: "intro_call" },
      select: { key: true },
    });
    expect(result.consultationTypeKey).toBe("intro_call");
  });
});
