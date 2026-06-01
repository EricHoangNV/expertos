/**
 * Live integration tests for {@link PgVectorStore} (M11 — the deferred "Testcontainers"
 * pass for the M1.2 hybrid-retrieval raw-SQL path).
 *
 * The unit suite `pgvector.store.test.ts` mocks `$queryRawUnsafe`, so it can only prove the
 * SQL *string* and bound params are assembled correctly — it cannot prove Postgres actually
 * (a) orders by cosine distance over the pgvector `chunks.embedding` HNSW column, (b) returns
 * `ts_rank` keyword scores, (c) binds a JS `string[]` through `scope = ANY($n::content_scope[])`,
 * or (d) honours RLS tenant isolation on the `knowledge`-family `chunks` table. This suite
 * runs the real driver against a real Postgres to close exactly those gaps (the two items
 * flagged in the M1.2 follow-up: the `ANY($n::content_scope[])` array bind, and cosine `<=>`
 * ordering + `ts_rank` coming back as JS numbers).
 *
 * OPT-IN: gated on `RLS_TEST_DATABASE_URL` (a connection string for the **app_user** role so
 * RLS is enforced). When unset the suite is skipped, so `pnpm test` stays green on a box with
 * no database. It is excluded from the default Jest run (see `jest.config.cjs`
 * `testPathIgnorePatterns`) and runs via `pnpm --filter @expertos/api test:integration`.
 * The Prisma library engine SIGILLs on this aarch64/linuxkit sandbox, so regenerate the
 * client with the binary engine first (see `LEARNINGS` / the db package):
 *
 *   PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate
 *   PRISMA_CLIENT_ENGINE_TYPE=binary \
 *     RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" \
 *     pnpm --filter @expertos/api test:integration
 */
import { randomUUID } from "node:crypto";
import type { RetrievalRequest } from "@expertos/ai";
import {
  applyRlsContext,
  PrismaClient,
  type Prisma,
  type RlsContext,
} from "@expertos/db";
import { toVectorLiteral } from "../database/vector";
import { PgVectorStore } from "./pgvector.store";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

const EMBEDDING_DIMS = 1536;

/** A 1536-dim vector with the supplied leading components and the rest zero. */
function embed(...leading: number[]): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  leading.forEach((value, i) => {
    v[i] = value;
  });
  return v;
}

describeLive("PgVectorStore live integration (app_user role)", () => {
  let prisma: PrismaClient;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID(); // a *context* only — no rows; proves cross-tenant isolation
  const docA = randomUUID();
  const dvA = randomUUID();

  // The query vector points along axis 0, so cosine similarity ranks the chunks
  // near (axis 0) > mid (45° off) > far (orthogonal).
  const qNear = embed(1);

  const cNear = randomUUID(); // axis 0   → cosine 1
  const cMid = randomUUID(); //  45° off  → cosine ~0.707
  const cFarVi = randomUUID(); // orthogonal → cosine 0; Vietnamese, tenant_customer
  const cPending = randomUUID(); // axis 0 but status=pending → excluded by the published gate
  const myIds = new Set<string>([cNear, cMid, cFarVi, cPending]);

  async function asCtx<T>(
    ctx: RlsContext,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await applyRlsContext(tx as unknown as PrismaClient, ctx);
      return fn(tx as unknown as PrismaClient);
    });
  }

  /** Run the real driver inside an RLS-scoped transaction. */
  async function retrieve(ctx: RlsContext, request: RetrievalRequest) {
    return asCtx(ctx, (tx) =>
      new PgVectorStore(tx as unknown as Prisma.TransactionClient).retrieve(
        request,
      ),
    );
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: RLS_TEST_DATABASE_URL } },
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES ($1::uuid, $2, $3, now())`,
      tenantA,
      `vec-a-${tag}`,
      `Vec A ${tag}`,
    );

    // Seed the document tree under an admin context (is_admin bypasses the knowledge
    // WITH CHECK). Every row carries tenant_id = tenantA explicitly, so the chunks are
    // tenant-scoped (NOT GLOBAL) — that is what the isolation test below relies on.
    await asCtx({ tenantId: tenantA, isAdmin: true }, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO documents (id, tenant_id, scope, title, language, status, updated_at)
         VALUES ($1::uuid, $2::uuid, 'global_expert'::content_scope, $3, 'en'::language, 'published'::publish_status, now())`,
        docA,
        tenantA,
        `doc ${tag}`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO document_versions (id, tenant_id, document_id, version_number, status, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'published'::publish_status, now())`,
        dvA,
        tenantA,
        docA,
      );

      const insertChunk = (
        id: string,
        index: number,
        content: string,
        summary: string | null,
        scope: string,
        language: string,
        status: string,
        embedding: number[],
      ) =>
        tx.$executeRawUnsafe(
          `INSERT INTO chunks
             (id, tenant_id, scope, document_version_id, chunk_index, content, summary, language, status, embedding, created_at)
           VALUES ($1::uuid, $2::uuid, $3::content_scope, $4::uuid, $5, $6, $7, $8::language, $9::chunk_status, $10::vector, now())`,
          id,
          tenantA,
          scope,
          dvA,
          index,
          content.normalize("NFC"),
          summary,
          language,
          status,
          toVectorLiteral(embedding),
        );

      await insertChunk(
        cNear,
        0,
        "Photosynthesis converts sunlight into chemical energy in green plants.",
        "biology",
        "global_expert",
        "en",
        "published",
        embed(1, 0),
      );
      await insertChunk(
        cMid,
        1,
        "Cellular respiration occurs in the mitochondria of eukaryotic cells.",
        "biology",
        "shared_expert",
        "en",
        "published",
        embed(1, 1),
      );
      await insertChunk(
        cFarVi,
        2,
        "Hiệp ước hòa bình được ký kết tại Wien vào năm ngoái.",
        "history",
        "tenant_customer",
        "vi",
        "published",
        embed(0, 1),
      );
      await insertChunk(
        cPending,
        3,
        "Draft note about photosynthesis, still pending expert review.",
        null,
        "global_expert",
        "en",
        "pending",
        embed(1, 0),
      );
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Cascades through documents → document_versions → chunks (all ON DELETE CASCADE).
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = $1::uuid`,
      tenantA,
    );
    await prisma.$disconnect();
  });

  it("orders by cosine similarity and returns numeric scores", async () => {
    const res = await retrieve(
      { tenantId: tenantA },
      { text: "", embedding: qNear, topK: 50, filters: { status: "published" } },
    );
    const mine = res.filter((r) => myIds.has(r.chunkId));

    // near (cosine 1) → mid (~0.707) → far (0); the pending chunk is gated out.
    expect(mine.map((r) => r.chunkId)).toEqual([cNear, cMid, cFarVi]);
    expect(mine.every((r) => Number.isFinite(r.score))).toBe(true);

    const near = mine.find((r) => r.chunkId === cNear);
    const far = mine.find((r) => r.chunkId === cFarVi);
    expect(near?.vectorScore).toBeCloseTo(1, 5);
    expect(far?.vectorScore).toBeCloseTo(0, 5);
    expect(res.some((r) => r.chunkId === cPending)).toBe(false);
  });

  it("matches keyword full-text and surfaces ts_rank as a number (fusion boost)", async () => {
    // The query vector is far from cFarVi (cosine 0), so only the keyword modality can
    // lift it — proving the keyword path runs and ts_rank fuses in.
    const res = await retrieve(
      { tenantId: tenantA },
      {
        text: "Wien hòa bình".normalize("NFC"),
        embedding: qNear,
        topK: 50,
        filters: { status: "published" },
      },
    );

    const far = res.find((r) => r.chunkId === cFarVi);
    expect(far).toBeDefined();
    expect(typeof far?.keywordScore).toBe("number");
    expect(far?.keywordScore ?? 0).toBeGreaterThan(0);
    // Keyword + vector contributions outrank the vector-only top hit.
    expect(res[0]?.chunkId).toBe(cFarVi);
  });

  it("binds a JS string[] through scope = ANY($n::content_scope[])", async () => {
    const res = await retrieve(
      { tenantId: tenantA },
      {
        text: "",
        embedding: qNear,
        topK: 50,
        filters: {
          status: "published",
          scope: ["global_expert", "tenant_customer"],
        },
      },
    );
    const ids = res.map((r) => r.chunkId);
    expect(ids).toContain(cNear); // global_expert
    expect(ids).toContain(cFarVi); // tenant_customer
    expect(ids).not.toContain(cMid); // shared_expert is filtered out
  });

  it("filters by language", async () => {
    const res = await retrieve(
      { tenantId: tenantA },
      {
        text: "",
        embedding: qNear,
        topK: 50,
        filters: { status: "published", language: "vi" },
      },
    );
    expect(res.filter((r) => myIds.has(r.chunkId)).map((r) => r.chunkId)).toEqual(
      [cFarVi],
    );
  });

  it("filters by chunk status (only pending when asked)", async () => {
    const res = await retrieve(
      { tenantId: tenantA },
      { text: "", embedding: qNear, topK: 50, filters: { status: "pending" } },
    );
    expect(res.filter((r) => myIds.has(r.chunkId)).map((r) => r.chunkId)).toEqual(
      [cPending],
    );
  });

  it("enforces RLS: another tenant sees none of these tenant-scoped chunks", async () => {
    const res = await retrieve(
      { tenantId: tenantB },
      {
        text: "Wien hòa bình".normalize("NFC"),
        embedding: qNear,
        topK: 50,
        filters: { status: "published" },
      },
    );
    expect(res.filter((r) => myIds.has(r.chunkId))).toEqual([]);
  });
});
