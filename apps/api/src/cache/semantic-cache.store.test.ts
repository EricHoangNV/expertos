import type { Prisma } from "@expertos/db";
import { PgSemanticCacheStore } from "./semantic-cache.store";
import type { CachedAnswer } from "./cache.types";

const TENANT = "22222222-2222-2222-2222-222222222222";
const CUTOFF = new Date("2026-05-31T00:00:00.000Z");

function fakeTx(row?: unknown) {
  return {
    semanticCacheEntry: {
      findFirst: jest.fn().mockResolvedValue(row ?? null),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function store(tx: ReturnType<typeof fakeTx>) {
  return new PgSemanticCacheStore(tx as unknown as Prisma.TransactionClient);
}

describe("PgSemanticCacheStore.lookup", () => {
  it("returns the cached answer, derives provenance, and bumps the hit counter", async () => {
    const row = {
      id: "e1",
      answer: "Answer [1][2].",
      model: "m1",
      citations: [
        { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "a" },
        { ordinal: 2, chunkId: "c2", documentVersionId: "dv1", content: "b" },
      ],
    };
    const tx = fakeTx(row);

    const result = await store(tx).lookup({
      tenantId: TENANT,
      normalizedQuestion: "key",
      model: "m1",
      notOlderThan: CUTOFF,
    });

    expect(result).toEqual({
      text: "Answer [1][2].",
      model: "m1",
      // De-duped to the single distinct document version.
      sourceVersionIds: ["dv1"],
      citations: row.citations,
    });
    expect(tx.semanticCacheEntry.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { hits: { increment: 1 } },
    });

    const where = tx.semanticCacheEntry.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, normalizedQuestion: "key", model: "m1" });
    expect(where.createdAt).toEqual({ gte: CUTOFF });
  });

  it("returns null and bumps nothing on a miss", async () => {
    const tx = fakeTx(null);
    const result = await store(tx).lookup({
      tenantId: TENANT,
      normalizedQuestion: "key",
      model: "m1",
      notOlderThan: CUTOFF,
    });
    expect(result).toBeNull();
    expect(tx.semanticCacheEntry.update).not.toHaveBeenCalled();
  });

  it("falls back to the request model and empty citations when the row lacks them", async () => {
    const tx = fakeTx({ id: "e1", answer: "A", model: null, citations: null });
    const result = await store(tx).lookup({
      tenantId: TENANT,
      normalizedQuestion: "key",
      model: "fallback",
      notOlderThan: CUTOFF,
    });
    expect(result).toEqual({ text: "A", model: "fallback", sourceVersionIds: [], citations: [] });
  });
});

describe("PgSemanticCacheStore.store", () => {
  const answer: CachedAnswer = {
    text: "Answer [1].",
    model: "m1",
    sourceVersionIds: ["dv1"],
    citations: [
      { ordinal: 1, chunkId: "c1", documentVersionId: "dv1", content: "a" },
      // An upload-shaped citation with an empty chunk id must not pollute chunkIds (uuid column).
      { ordinal: 2, chunkId: "", documentVersionId: "", content: "b" },
    ],
  };

  it("replaces any prior entry for the key then inserts the new answer", async () => {
    const tx = fakeTx();
    await store(tx).store({ tenantId: TENANT, normalizedQuestion: "key", model: "m1", answer });

    expect(tx.semanticCacheEntry.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, normalizedQuestion: "key", model: "m1" },
    });
    expect(tx.semanticCacheEntry.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT,
        normalizedQuestion: "key",
        model: "m1",
        answer: "Answer [1].",
        chunkIds: ["c1"],
        citations: answer.citations,
      },
    });
  });
});
