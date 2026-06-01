/**
 * Live integration tests for {@link PgExpertStore} (M11 — the deferred "Testcontainers" pass for
 * the M2.2 selectable-experts raw-SQL path).
 *
 * The unit suite mocks `$queryRawUnsafe`, so it can only prove the SQL *string* and bound params
 * are assembled correctly — it cannot prove Postgres actually (a) folds each expert's published
 * languages into a JS `string[]` via `array_agg(DISTINCT … ORDER BY …)` (the explicitly-flagged
 * item), (b) joins/filters so a *retired* expert or an *unpublished* profile never reaches the
 * picker, (c) narrows by `vp.language = $n::language`, (d) orders by `display_name`, or (e) honours
 * RLS tenant isolation on the `tenant_only` `experts`/`voice_profiles` tables. This suite runs the
 * real driver against a real Postgres to close exactly those gaps.
 *
 * OPT-IN: gated on `RLS_TEST_DATABASE_URL` (a connection string for the **app_user** role so RLS is
 * enforced). When unset the suite is skipped, so `pnpm test` stays green on a box with no database.
 * It is excluded from the default Jest run (see `jest.config.cjs` `testPathIgnorePatterns`) and runs
 * via `pnpm --filter @expertos/api test:integration`. The Prisma library engine SIGILLs on this
 * aarch64/linuxkit sandbox, so regenerate the client with the binary engine first:
 *
 *   PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate
 *   PRISMA_CLIENT_ENGINE_TYPE=binary \
 *     RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" \
 *     pnpm --filter @expertos/api test:integration
 */
import { randomUUID } from "node:crypto";
import {
  applyRlsContext,
  PrismaClient,
  type Prisma,
  type RlsContext,
} from "@expertos/db";
import { PgExpertStore } from "./expert.store";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("PgExpertStore live integration (app_user role)", () => {
  let prisma: PrismaClient;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID(); // a different tenant — proves cross-tenant isolation

  // tenantA experts. Names chosen so display_name ASC ordering is observable.
  const eAlice = randomUUID(); // active, EN + VI published profiles
  const eBob = randomUUID(); // active, EN published only
  const eRetired = randomUUID(); // INACTIVE — must never appear
  const eDraftOnly = randomUUID(); // active, but only a DRAFT profile — must never appear
  // tenantB expert (active + published) — must be invisible to a tenantA reader.
  const eOther = randomUUID();

  const myExpertIds = new Set<string>([eAlice, eBob, eRetired, eDraftOnly]);

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
  async function listExperts(
    ctx: RlsContext,
    language: "en" | "vi" | undefined,
    limit: number,
  ) {
    return asCtx(ctx, (tx) =>
      new PgExpertStore(tx as unknown as Prisma.TransactionClient).listExperts(
        language,
        limit,
      ),
    );
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: RLS_TEST_DATABASE_URL } },
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES
         ($1::uuid, $2, $3, now()), ($4::uuid, $5, $6, now())`,
      tenantA, `exp-a-${tag}`, `Exp A ${tag}`,
      tenantB, `exp-b-${tag}`, `Exp B ${tag}`,
    );

    const insertExpert = (
      tx: PrismaClient,
      id: string,
      tenantId: string,
      slug: string,
      displayName: string,
      active: boolean,
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO experts (id, tenant_id, slug, display_name, active, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, now())`,
        id, tenantId, slug, displayName, active,
      );

    const insertProfile = (
      tx: PrismaClient,
      tenantId: string,
      expertId: string,
      language: string,
      status: string,
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO voice_profiles (id, tenant_id, expert_id, language, name, status, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::language, $5, $6::publish_status, now())`,
        randomUUID(), tenantId, expertId, language, `${language} voice`, status,
      );

    // Seed under an admin context (is_admin bypasses the tenant_only WITH CHECK), writing rows for
    // both tenants in one pass — exactly the cross-tenant write a normal context cannot do.
    await asCtx({ tenantId: tenantA, isAdmin: true }, async (tx) => {
      await insertExpert(tx, eAlice, tenantA, `alice-${tag}`, "Alice Anderson", true);
      await insertProfile(tx, tenantA, eAlice, "en", "published");
      await insertProfile(tx, tenantA, eAlice, "vi", "published");
      // A second EN profile for Alice — DISTINCT must collapse it to one "en" entry.
      await insertProfile(tx, tenantA, eAlice, "en", "published");

      await insertExpert(tx, eBob, tenantA, `bob-${tag}`, "Bob Brown", true);
      await insertProfile(tx, tenantA, eBob, "en", "published");

      // Retired (inactive) expert with a published profile — filtered by e.active = true.
      await insertExpert(tx, eRetired, tenantA, `retired-${tag}`, "Rita Retired", false);
      await insertProfile(tx, tenantA, eRetired, "en", "published");

      // Active expert with only a draft profile — filtered by vp.status = 'published'.
      await insertExpert(tx, eDraftOnly, tenantA, `draft-${tag}`, "Dan Draft", true);
      await insertProfile(tx, tenantA, eDraftOnly, "en", "draft");

      // tenantB expert (active + published) — only visible to a tenantB reader.
      await insertExpert(tx, eOther, tenantB, `other-${tag}`, "Olga Other", true);
      await insertProfile(tx, tenantB, eOther, "en", "published");
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

  it("lists only active experts with a published profile, ordered by display_name", async () => {
    const res = await listExperts({ tenantId: tenantA }, undefined, 50);
    const mine = res.filter((r) => myExpertIds.has(r.expertId));

    // Alice + Bob only — the retired and draft-only experts are filtered out in SQL.
    expect(mine.map((r) => r.expertId)).toEqual([eAlice, eBob]);
    expect(mine.every((r) => r.hasActiveProfile === true)).toBe(true);
  });

  it("folds each expert's published languages into a sorted, de-duped string[]", async () => {
    const res = await listExperts({ tenantId: tenantA }, undefined, 50);

    const alice = res.find((r) => r.expertId === eAlice);
    const bob = res.find((r) => r.expertId === eBob);
    // array_agg(DISTINCT … ORDER BY …) → sorted, no duplicate "en" despite two EN profiles.
    expect(alice?.languages).toEqual(["en", "vi"]);
    expect(bob?.languages).toEqual(["en"]);
  });

  it("narrows to experts with a published profile in the requested language", async () => {
    const res = await listExperts({ tenantId: tenantA }, "vi", 50);
    const mine = res.filter((r) => myExpertIds.has(r.expertId));
    // Only Alice has a VI profile; the languages column is the VI-filtered aggregate.
    expect(mine.map((r) => r.expertId)).toEqual([eAlice]);
    expect(mine[0]?.languages).toEqual(["vi"]);
  });

  it("honours the limit bind", async () => {
    const res = await listExperts({ tenantId: tenantA }, "en", 1);
    // display_name ASC → Alice first; LIMIT 1 stops there.
    expect(res).toHaveLength(1);
    expect(res[0]?.expertId).toBe(eAlice);
  });

  it("enforces RLS: a tenant sees none of another tenant's experts", async () => {
    const fromA = await listExperts({ tenantId: tenantA }, undefined, 50);
    expect(fromA.some((r) => r.expertId === eOther)).toBe(false);

    const fromB = await listExperts({ tenantId: tenantB }, undefined, 50);
    expect(fromB.some((r) => myExpertIds.has(r.expertId))).toBe(false);
    expect(fromB.some((r) => r.expertId === eOther)).toBe(true);
  });
});
