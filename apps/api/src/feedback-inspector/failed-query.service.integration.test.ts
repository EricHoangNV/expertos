/**
 * Live integration tests for {@link FailedQueryService} (M11 — the deferred "Testcontainers" pass
 * for the M8.3 failed/low-confidence query inspector's raw-SQL `LATERAL` path).
 *
 * The unit suite mocks `$queryRawUnsafe`, so it can only prove the SQL *string* and bound params —
 * it cannot prove Postgres actually (a) `LATERAL`-joins back to the most-recent user message at/
 * before the answer for the prompting question, (b) derives the insufficient-knowledge flag from an
 * empty `source_version_ids` array (`cardinality(...) = 0`), (c) returns only `helpful = false` rows
 * newest-first with limit/offset, or (d) — under the **admin** `is_admin` GUC — reads cross-tenant
 * (no `tenant_id` predicate). This suite runs the real service + {@link RlsService} (so the RLS
 * context is derived exactly as in production) against a real Postgres to close those gaps.
 *
 * OPT-IN: gated on `RLS_TEST_DATABASE_URL` (a connection string for the **app_user** role). When
 * unset the suite is skipped. Excluded from the default Jest run (`jest.config.cjs`
 * `testPathIgnorePatterns`); runs via `pnpm --filter @expertos/api test:integration`. Regenerate the
 * Prisma client with the binary engine first on this aarch64/linuxkit sandbox (see the db package).
 */
import { randomUUID } from "node:crypto";
import {
  applyRlsContext,
  PrismaClient,
  type RlsContext,
} from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { FailedQueryService } from "./failed-query.service";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("FailedQueryService live integration (app_user role)", () => {
  let prisma: PrismaClient;
  let service: FailedQueryService;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  // tenantA conversation: a question, then a 👎-rated insufficient answer.
  const convA = randomUUID();
  const qMsgA = randomUUID(); // user question (earlier)
  const ansInsufficientA = randomUUID(); // assistant, empty source_version_ids, 👎
  const ansGroundedA = randomUUID(); // assistant, grounded, 👍 (must NOT appear)
  const fbInsufficientA = randomUUID(); // the 👎 feedback row

  // tenantB conversation: a 👎-rated grounded answer with no preceding user message.
  const convB = randomUUID();
  const ansNoQuestionB = randomUUID(); // assistant, grounded, 👎, no user message before it
  const fbB = randomUUID();

  const dvId = randomUUID(); // a fake document_version id for the grounded answer's provenance

  function authUser(id: string, tenantId: string, role: "user" | "admin"): AuthUser {
    return {
      id,
      tenantId,
      firebaseUid: `fb-${id}`,
      email: `${id}@t.test`,
      displayName: null,
      role,
      locale: "en",
    };
  }

  async function asCtx<T>(
    ctx: RlsContext,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await applyRlsContext(tx as unknown as PrismaClient, ctx);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: RLS_TEST_DATABASE_URL } },
    });
    service = new FailedQueryService(new RlsService(prisma));

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES
         ($1::uuid, $2, $3, now()), ($4::uuid, $5, $6, now())`,
      tenantA, `fq-a-${tag}`, `FQ A ${tag}`,
      tenantB, `fq-b-${tag}`, `FQ B ${tag}`,
    );

    await asCtx({ tenantId: tenantA, isAdmin: true }, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, firebase_uid, email, updated_at) VALUES
           ($1::uuid, $2::uuid, $3, $4, now()),
           ($5::uuid, $6::uuid, $7, $8, now())`,
        userA, tenantA, `fb-a-${tag}`, `a-${tag}@t.test`,
        userB, tenantB, `fb-b-${tag}`, `b-${tag}@t.test`,
      );

      // ── tenantA conversation ──
      await tx.$executeRawUnsafe(
        `INSERT INTO conversations (id, tenant_id, user_id, title, language, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'en'::language, now(), now())`,
        convA, tenantA, userA, "garden",
      );
      // user question at T0
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'user'::message_role, $4, now() - interval '20 seconds')`,
        qMsgA, tenantA, convA, "How do I prune roses in winter?",
      );
      // assistant insufficient answer at T0+10s (empty source_version_ids), with model + confidence
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, model, confidence, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, $5, $6, now() - interval '10 seconds')`,
        ansInsufficientA, tenantA, convA, "I don't have enough knowledge to answer that.", "echo-dev", 0.2,
      );
      // assistant grounded answer at T0+11s, with provenance (NOT insufficient), 👍-rated
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, model, source_version_ids, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, $5, ARRAY[$6::uuid], now() - interval '9 seconds')`,
        ansGroundedA, tenantA, convA, "Prune just above an outward-facing bud.", "echo-dev", dvId,
      );

      // 👎 on the insufficient answer (the one the inspector must surface). Explicit created_at
      // (now() is constant within a transaction) so the newest-first ordering is deterministic:
      // this row is OLDER than tenantB's below.
      await tx.$executeRawUnsafe(
        `INSERT INTO answer_feedback (id, tenant_id, user_id, message_id, helpful, reason, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, false, $5, now() - interval '2 seconds')`,
        fbInsufficientA, tenantA, userA, ansInsufficientA, "Did not answer my question",
      );
      // 👍 on the grounded answer — must be excluded (helpful = true)
      await tx.$executeRawUnsafe(
        `INSERT INTO answer_feedback (id, tenant_id, user_id, message_id, helpful, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true, now())`,
        randomUUID(), tenantA, userA, ansGroundedA,
      );

      // ── tenantB conversation (cross-tenant + no-question case) ──
      await tx.$executeRawUnsafe(
        `INSERT INTO conversations (id, tenant_id, user_id, title, language, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'en'::language, now(), now())`,
        convB, tenantB, userB, "physics",
      );
      // assistant answer with NO user message before it; grounded (so insufficient = false)
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, source_version_ids, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, ARRAY[$5::uuid], now() - interval '5 seconds')`,
        ansNoQuestionB, tenantB, convB, "The answer is 42.", dvId,
      );
      // Newer than tenantA's 👎 above → comes first under ORDER BY created_at DESC.
      await tx.$executeRawUnsafe(
        `INSERT INTO answer_feedback (id, tenant_id, user_id, message_id, helpful, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, false, now() - interval '1 second')`,
        fbB, tenantB, userB, ansNoQuestionB,
      );
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = ANY($1::uuid[])`,
      [tenantA, tenantB],
    );
    await prisma.$disconnect();
  });

  /** Restrict to the rows this test seeded (the table may hold other tenants' feedback). */
  async function listMine(admin: AuthUser) {
    const res = await service.list(admin, { limit: 100, offset: 0 });
    const mine = new Set<string>([fbInsufficientA, fbB]);
    return res.filter((r) => mine.has(r.feedbackId));
  }

  it("surfaces a 👎 answer with its LATERAL-resolved question and insufficient flag", async () => {
    const admin = authUser(randomUUID(), tenantA, "admin");
    const rows = await listMine(admin);

    const hit = rows.find((r) => r.feedbackId === fbInsufficientA);
    expect(hit).toBeDefined();
    expect(hit?.messageId).toBe(ansInsufficientA);
    expect(hit?.conversationId).toBe(convA);
    // LATERAL picked the most-recent user message at/before the answer.
    expect(hit?.question).toBe("How do I prune roses in winter?");
    expect(hit?.reason).toBe("Did not answer my question");
    expect(hit?.model).toBe("echo-dev");
    expect(hit?.confidence).toBeCloseTo(0.2, 5);
    // Empty source_version_ids → insufficient-knowledge proxy is true.
    expect(hit?.insufficientKnowledge).toBe(true);
    expect(typeof hit?.createdAt).toBe("string");
  });

  it("excludes 👍-rated answers (helpful = true)", async () => {
    const admin = authUser(randomUUID(), tenantA, "admin");
    const res = await service.list(admin, { limit: 100, offset: 0 });
    expect(res.some((r) => r.messageId === ansGroundedA)).toBe(false);
  });

  it("reads cross-tenant under the admin GUC and preserves a null question / grounded flag", async () => {
    const admin = authUser(randomUUID(), tenantA, "admin"); // admin of tenantA still sees tenantB's row
    const rows = await listMine(admin);

    const tenantBHit = rows.find((r) => r.feedbackId === fbB);
    expect(tenantBHit).toBeDefined();
    expect(tenantBHit?.conversationId).toBe(convB);
    // No user message before the answer → LATERAL yields no question.
    expect(tenantBHit?.question).toBeNull();
    expect(tenantBHit?.model).toBeNull();
    expect(tenantBHit?.confidence).toBeNull();
    // Grounded answer (non-empty source_version_ids) → not insufficient.
    expect(tenantBHit?.insufficientKnowledge).toBe(false);
  });

  it("orders newest-first", async () => {
    const admin = authUser(randomUUID(), tenantA, "admin");
    // Filter to my own rows (the admin read is platform-wide, so other tenants' feedback may be
    // interleaved); within mine, fbB (newer created_at) must precede fbInsufficientA.
    const rows = await listMine(admin);
    const ids = rows.map((r) => r.feedbackId);
    expect(ids.indexOf(fbB)).toBeLessThan(ids.indexOf(fbInsufficientA));
  });

  it("honours limit / offset paging", async () => {
    const admin = authUser(randomUUID(), tenantA, "admin");
    const big = await service.list(admin, { limit: 100, offset: 0 });
    // A 1-row page must be a strict prefix of the full ordered list.
    const page1 = await service.list(admin, { limit: 1, offset: 0 });
    expect(page1).toHaveLength(1);
    expect(page1[0]?.feedbackId).toBe(big[0]?.feedbackId);
    if (big.length > 1) {
      const page2 = await service.list(admin, { limit: 1, offset: 1 });
      expect(page2[0]?.feedbackId).toBe(big[1]?.feedbackId);
    }
  });
});
