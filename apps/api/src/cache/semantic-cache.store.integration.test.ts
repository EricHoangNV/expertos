/**
 * Live integration tests for {@link PgSemanticCacheStore} (M11 — the deferred "Testcontainers" pass
 * for the M6.4 persistent answer-cache tier).
 *
 * The store uses Prisma Client model methods (not raw SQL), so the unit suite mocks the tx and
 * proves the call shape — but only a real database proves (a) the `citations` jsonb payload round-
 * trips faithfully (so a cache hit rebuilds the `done` event + persisted rows) and `sourceVersionIds`
 * is derived from it, (b) `lookup` increments the hit counter and the `notOlderThan` (TTL) cutoff
 * excludes stale rows, (c) the model tier is part of the key (a different tier misses), (d) `store`
 * replaces a prior entry for the key (one live row), and (e) RLS isolates the `tenant_only`
 * `semantic_cache` table across tenants. This suite runs the real store against a real Postgres.
 *
 * OPT-IN: gated on `RLS_TEST_DATABASE_URL` (an **app_user** connection string). When unset the suite
 * is skipped. Excluded from the default Jest run (`jest.config.cjs` `testPathIgnorePatterns`); runs
 * via `pnpm --filter @expertos/api test:integration`. Regenerate the Prisma client with the binary
 * engine first on this aarch64/linuxkit sandbox (see the db package).
 */
import { randomUUID } from "node:crypto";
import {
  applyRlsContext,
  PrismaClient,
  type Prisma,
  type RlsContext,
} from "@expertos/db";
import type { CachedAnswer } from "./cache.types";
import { PgSemanticCacheStore } from "./semantic-cache.store";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("PgSemanticCacheStore live integration (app_user role)", () => {
  let prisma: PrismaClient;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const dvId = randomUUID();
  const chunkId = randomUUID();

  const key = `what is photosynthesis? :: scope=global :: lang=en`;
  const model = "echo-dev";

  const answer: CachedAnswer = {
    text: "Photosynthesis converts sunlight into chemical energy. [1]",
    model,
    sourceVersionIds: [dvId],
    citations: [
      {
        ordinal: 1,
        chunkId,
        documentVersionId: dvId,
        content: "Photosynthesis occurs in the chloroplasts of green plants.",
      },
    ],
  };

  async function asCtx<T>(
    ctx: RlsContext,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await applyRlsContext(tx as unknown as PrismaClient, ctx);
      return fn(tx as unknown as PrismaClient);
    });
  }

  function store(tx: PrismaClient) {
    return new PgSemanticCacheStore(tx as unknown as Prisma.TransactionClient);
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: RLS_TEST_DATABASE_URL } },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES
         ($1::uuid, $2, $3, now()), ($4::uuid, $5, $6, now())`,
      tenantA, `sc-a-${tag}`, `SC A ${tag}`,
      tenantB, `sc-b-${tag}`, `SC B ${tag}`,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = ANY($1::uuid[])`,
      [tenantA, tenantB],
    );
    await prisma.$disconnect();
  });

  it("round-trips the citations jsonb and derives sourceVersionIds on lookup", async () => {
    await asCtx({ tenantId: tenantA }, (tx) =>
      store(tx).store({ tenantId: tenantA, normalizedQuestion: key, model, answer }),
    );

    const hit = await asCtx({ tenantId: tenantA }, (tx) =>
      store(tx).lookup({
        tenantId: tenantA,
        normalizedQuestion: key,
        model,
        notOlderThan: new Date(Date.now() - 60_000),
      }),
    );

    expect(hit).not.toBeNull();
    expect(hit?.text).toBe(answer.text);
    expect(hit?.model).toBe(model);
    expect(hit?.citations).toHaveLength(1);
    expect(hit?.citations[0]).toMatchObject({
      ordinal: 1,
      chunkId,
      documentVersionId: dvId,
      content: "Photosynthesis occurs in the chloroplasts of green plants.",
    });
    // sourceVersionIds is derived from the citations' documentVersionId, de-duped.
    expect(hit?.sourceVersionIds).toEqual([dvId]);
  });

  it("increments the hit counter on each lookup", async () => {
    const lookup = (tx: PrismaClient) =>
      store(tx).lookup({
        tenantId: tenantA,
        normalizedQuestion: key,
        model,
        notOlderThan: new Date(Date.now() - 60_000),
      });
    await asCtx({ tenantId: tenantA }, lookup);
    await asCtx({ tenantId: tenantA }, lookup);

    const row = await asCtx({ tenantId: tenantA }, (tx) =>
      tx.semanticCacheEntry.findFirst({
        where: { tenantId: tenantA, normalizedQuestion: key, model },
        select: { hits: true },
      }),
    );
    // 1 lookup in the prior test + 2 here = 3.
    expect(row?.hits).toBe(3);
  });

  it("misses when the entry is older than the TTL cutoff", async () => {
    const hit = await asCtx({ tenantId: tenantA }, (tx) =>
      store(tx).lookup({
        tenantId: tenantA,
        normalizedQuestion: key,
        model,
        // Cutoff one minute in the FUTURE → the just-written row is "too old".
        notOlderThan: new Date(Date.now() + 60_000),
      }),
    );
    expect(hit).toBeNull();
  });

  it("misses when the model tier differs (model is part of the key)", async () => {
    const hit = await asCtx({ tenantId: tenantA }, (tx) =>
      store(tx).lookup({
        tenantId: tenantA,
        normalizedQuestion: key,
        model: "echo-dev-mini", // the degraded tier — must not serve the standard-tier answer
        notOlderThan: new Date(Date.now() - 60_000),
      }),
    );
    expect(hit).toBeNull();
  });

  it("store replaces any prior entry for the key (one live row)", async () => {
    const revised: CachedAnswer = {
      ...answer,
      text: "Revised: photosynthesis stores energy in glucose. [1]",
    };
    await asCtx({ tenantId: tenantA }, (tx) =>
      store(tx).store({ tenantId: tenantA, normalizedQuestion: key, model, answer: revised }),
    );

    const rows = await asCtx({ tenantId: tenantA }, (tx) =>
      tx.semanticCacheEntry.findMany({
        where: { tenantId: tenantA, normalizedQuestion: key, model },
        select: { answer: true, hits: true },
      }),
    );
    // deleteMany + create → exactly one row, with the revised text and a reset hit counter.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answer).toBe(revised.text);
    expect(rows[0]?.hits).toBe(0);
  });

  it("enforces RLS: another tenant cannot read this tenant's cache entry", async () => {
    const hit = await asCtx({ tenantId: tenantB }, (tx) =>
      store(tx).lookup({
        tenantId: tenantA, // ask for tenantA's key from within tenantB's RLS context
        normalizedQuestion: key,
        model,
        notOlderThan: new Date(Date.now() - 60_000),
      }),
    );
    expect(hit).toBeNull();
  });
});
