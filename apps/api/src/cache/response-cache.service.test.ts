import { ResponseCacheService } from "./response-cache.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { RetrievalQueryInput } from "@expertos/shared";
import type { RetrievedChunk } from "@expertos/ai";
import type { CachedAnswer } from "./cache.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const CHUNKS: RetrievedChunk[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "fact", score: 0.9 },
];

function query(over: Partial<RetrievalQueryInput["filters"]> = {}, rest: Partial<RetrievalQueryInput> = {}): RetrievalQueryInput {
  return { text: "How do I FILE taxes?", topK: 8, filters: { status: "published", ...over }, ...rest };
}

interface FakeTx {
  semanticCacheEntry: {
    findFirst: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
    create: jest.Mock;
  };
}

function makeService(row?: unknown) {
  const tx: FakeTx = {
    semanticCacheEntry: {
      findFirst: jest.fn().mockResolvedValue(row ?? null),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  const service = new ResponseCacheService(rls, logger);
  return { service, tx, run, info };
}

describe("ResponseCacheService keys", () => {
  it("builds a deterministic, whitespace/case-insensitive retrieval key", () => {
    const { service } = makeService();
    const a = service.retrievalKey(USER.tenantId, query({}, { text: "How  do I FILE   taxes?" }));
    const b = service.retrievalKey(USER.tenantId, query({}, { text: "how do i file taxes?" }));
    expect(a).toBe(b);
  });

  it("forks the retrieval key on topK, status, language, and scope", () => {
    const { service } = makeService();
    const base = service.retrievalKey(USER.tenantId, query());
    expect(service.retrievalKey(USER.tenantId, query({}, { topK: 3 }))).not.toBe(base);
    expect(service.retrievalKey(USER.tenantId, query({ status: "archived" }))).not.toBe(base);
    expect(service.retrievalKey(USER.tenantId, query({ language: "vi" }))).not.toBe(base);
    expect(service.retrievalKey(USER.tenantId, query({ scope: ["global_expert"] }))).not.toBe(base);
  });

  it("does not fork the retrieval key on scope ordering", () => {
    const { service } = makeService();
    const a = service.retrievalKey(USER.tenantId, query({ scope: ["global_expert", "user_private"] }));
    const b = service.retrievalKey(USER.tenantId, query({ scope: ["user_private", "global_expert"] }));
    expect(a).toBe(b);
  });

  it("forks the answer key on model tier, expert, language, and topK", () => {
    const { service } = makeService();
    const base = service.answerKey(USER.tenantId, { text: "q", topK: 8, model: "m1" });
    expect(service.answerKey(USER.tenantId, { text: "q", topK: 8, model: "m2" })).not.toBe(base);
    expect(service.answerKey(USER.tenantId, { text: "q", topK: 8, model: "m1", expertId: "e1" })).not.toBe(base);
    expect(service.answerKey(USER.tenantId, { text: "q", topK: 8, model: "m1", language: "vi" })).not.toBe(base);
    expect(service.answerKey(USER.tenantId, { text: "q", topK: 3, model: "m1" })).not.toBe(base);
  });
});

describe("ResponseCacheService retrieval layer", () => {
  it("round-trips retrieved chunks in-process and misses on an unknown key", () => {
    const { service } = makeService();
    expect(service.getRetrieval("k")).toBeUndefined();
    service.setRetrieval("k", CHUNKS);
    expect(service.getRetrieval("k")).toBe(CHUNKS);
  });
});

describe("ResponseCacheService answer layer", () => {
  const ANSWER: CachedAnswer = {
    text: "Answer [1].",
    model: "m1",
    sourceVersionIds: ["dv1"],
    citations: [{ ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "fact" }],
  };

  it("returns an in-process hit without touching the database", async () => {
    const { service, tx } = makeService();
    await service.storeAnswer(USER, "key", ANSWER);
    tx.semanticCacheEntry.findFirst.mockClear();

    const hit = await service.lookupAnswer(USER, "key", "m1");
    expect(hit).toEqual(ANSWER);
    expect(tx.semanticCacheEntry.findFirst).not.toHaveBeenCalled();
  });

  it("write-throughs to the persistent store (replace-then-create)", async () => {
    const { service, tx, run } = makeService();
    await service.storeAnswer(USER, "key", ANSWER);

    expect(run).toHaveBeenCalledWith(USER, expect.any(Function));
    expect(tx.semanticCacheEntry.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.semanticCacheEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: USER.tenantId,
          normalizedQuestion: "key",
          model: "m1",
          answer: "Answer [1].",
          chunkIds: ["c1"],
        }),
      }),
    );
  });

  it("falls back to the persistent semantic cache and warms the in-process tier", async () => {
    const row = {
      id: "e1",
      answer: "Persisted [1].",
      model: "m1",
      citations: [{ ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "fact" }],
    };
    const { service, tx, info } = makeService(row);

    const hit = await service.lookupAnswer(USER, "key", "m1");
    expect(hit).toEqual({
      text: "Persisted [1].",
      model: "m1",
      sourceVersionIds: ["dv1"],
      citations: row.citations,
    });
    // Hit counter bumped; bounded by an age cutoff.
    expect(tx.semanticCacheEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1" }, data: { hits: { increment: 1 } } }),
    );
    expect(tx.semanticCacheEntry.findFirst.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
    expect(info).toHaveBeenCalledWith("answer cache hit", { tier: "semantic" });

    // Warmed: a second lookup is served from memory (no second DB read).
    tx.semanticCacheEntry.findFirst.mockClear();
    await service.lookupAnswer(USER, "key", "m1");
    expect(tx.semanticCacheEntry.findFirst).not.toHaveBeenCalled();
  });

  it("returns undefined on a full miss", async () => {
    const { service } = makeService();
    expect(await service.lookupAnswer(USER, "key", "m1")).toBeUndefined();
  });
});

describe("ResponseCacheService.invalidateTenant", () => {
  it("drops the tenant's in-process retrieval/answer entries and its semantic rows", async () => {
    const { service, tx, info } = makeService();
    tx.semanticCacheEntry.deleteMany.mockResolvedValue({ count: 2 });

    const rKey = service.retrievalKey(USER.tenantId, query());
    service.setRetrieval(rKey, CHUNKS);
    const aKey = service.answerKey(USER.tenantId, { text: "q", topK: 8, model: "m1" });
    await service.storeAnswer(USER, aKey, {
      text: "A [1].",
      model: "m1",
      sourceVersionIds: ["dv1"],
      citations: [{ ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "fact" }],
    });
    // Both layers are warm.
    expect(service.getRetrieval(rKey)).toEqual(CHUNKS);

    await service.invalidateTenant(USER);

    // In-process retrieval gone; in-process answer gone (a lookup now falls through to the DB,
    // which returns null → undefined).
    expect(service.getRetrieval(rKey)).toBeUndefined();
    expect(await service.lookupAnswer(USER, aKey, "m1")).toBeUndefined();
    // Persistent rows deleted, pinned to the acting tenant (admin/expert bypass RLS).
    expect(tx.semanticCacheEntry.deleteMany).toHaveBeenLastCalledWith({
      where: { tenantId: USER.tenantId },
    });
    expect(info).toHaveBeenCalledWith(
      "response cache invalidated for tenant",
      expect.objectContaining({ semanticDropped: 2 }),
    );
  });

  it("leaves a different tenant's in-process entries intact", async () => {
    const { service, tx } = makeService();
    tx.semanticCacheEntry.deleteMany.mockResolvedValue({ count: 0 });
    const otherTenant = "33333333-3333-3333-3333-333333333333";

    const mineKey = service.retrievalKey(USER.tenantId, query());
    const theirsKey = service.retrievalKey(otherTenant, query());
    service.setRetrieval(mineKey, CHUNKS);
    service.setRetrieval(theirsKey, CHUNKS);

    await service.invalidateTenant(USER);

    expect(service.getRetrieval(mineKey)).toBeUndefined();
    expect(service.getRetrieval(theirsKey)).toEqual(CHUNKS);
  });
});
