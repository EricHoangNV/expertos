/**
 * Live Row-Level Security integration tests (M11.2 — authz/RLS negative tests).
 *
 * These exercise the RLS policies from `20260531212901_rls_and_vector_index` against a
 * REAL Postgres, connecting as the non-superuser `app_user` role so the policies are
 * actually enforced (the owner/superuser bypasses RLS; FORCE ROW LEVEL SECURITY + a
 * non-BYPASSRLS role is what closes that path). The unit test `rls.test.ts` only proves
 * `applyRlsContext` emits the right `set_config` calls — it cannot prove the database
 * honours them. This suite is the structural-isolation guarantee the PRD §"Data Model"
 * promises, validated end-to-end.
 *
 * OPT-IN: gated on `RLS_TEST_DATABASE_URL` (a connection string for the **app_user**
 * role, NOT the owner). When unset the suite is skipped, so `pnpm test` stays green on a
 * box with no database. It is excluded from the default Jest run (see
 * `jest.config.cjs` `testPathIgnorePatterns`) and runs via `pnpm --filter @expertos/db
 * test:integration`. Example:
 *
 *   RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" \
 *     pnpm --filter @expertos/db test:integration
 *
 * The three policy families covered (matching the migration's `tenant_only` /
 * `user_scoped` / `knowledge` arrays):
 *   1. tenant_isolation       (users)         — read/write scoped to the acting tenant
 *   2. tenant_user_isolation  (conversations) — read/write scoped to the acting (tenant,user)
 *   3. tenant_write+global_read (documents)   — own-tenant writes; own + GLOBAL reads
 * plus the admin-bypass and the fail-closed-when-no-context behaviours.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../generated/client";
import { applyRlsContext, GLOBAL_TENANT_ID, type RlsContext } from "./rls";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;

// Skip the whole suite (rather than fail) when no live app_user database is configured.
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("RLS live integration (app_user role)", () => {
  let prisma: PrismaClient;

  // A short run tag keeps the unique slug/email/firebase_uid columns collision-free
  // across re-runs without a manual reset.
  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA1 = randomUUID(); // tenant A, user 1 (the "owner")
  const userA2 = randomUUID(); // tenant A, user 2 (same tenant, different user)
  const userB1 = randomUUID(); // tenant B, user 1
  const convoA1 = randomUUID(); // a conversation owned by (tenantA, userA1)
  const docA = randomUUID(); // a document in tenant A
  const docGlobal = randomUUID(); // a document in the GLOBAL tenant

  /** Run `fn` inside a transaction with the given RLS context applied. */
  async function asCtx<T>(
    ctx: RlsContext,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await applyRlsContext(tx as unknown as PrismaClient, ctx);
      return fn(tx as unknown as PrismaClient);
    });
  }

  /** Count rows of `table` whose id is in `ids`, under the supplied context. */
  async function countByIds(
    ctx: RlsContext,
    table: string,
    ids: string[],
  ): Promise<number> {
    const rows = await asCtx(ctx, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`,
        ids,
      ),
    );
    return rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: RLS_TEST_DATABASE_URL } },
    });

    // tenants has no RLS — seed the two test tenants directly as app_user.
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at)
       VALUES ($1::uuid, $2, $3, now()), ($4::uuid, $5, $6, now())`,
      tenantA,
      `rls-a-${tag}`,
      `RLS A ${tag}`,
      tenantB,
      `rls-b-${tag}`,
      `RLS B ${tag}`,
    );

    // Everything else is RLS-protected. Seed under an admin context (is_admin bypasses
    // the WITH CHECK), which lets us insert rows for several tenants/users in one go —
    // exactly the cross-tenant write the negative tests below prove a NORMAL context cannot do.
    await asCtx({ tenantId: tenantA, isAdmin: true }, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, firebase_uid, email, updated_at) VALUES
           ($1::uuid, $2::uuid, $3, $4, now()),
           ($5::uuid, $6::uuid, $7, $8, now()),
           ($9::uuid, $10::uuid, $11, $12, now())`,
        userA1, tenantA, `fb-a1-${tag}`, `a1-${tag}@t.test`,
        userA2, tenantA, `fb-a2-${tag}`, `a2-${tag}@t.test`,
        userB1, tenantB, `fb-b1-${tag}`, `b1-${tag}@t.test`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO conversations (id, tenant_id, user_id, title, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now())`,
        convoA1, tenantA, userA1, `convo ${tag}`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO documents (id, tenant_id, title, updated_at) VALUES
           ($1::uuid, $2::uuid, $3, now()),
           ($4::uuid, $5::uuid, $6, now())`,
        docA, tenantA, `docA ${tag}`,
        docGlobal, GLOBAL_TENANT_ID, `docGlobal ${tag}`,
      );
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Deleting the tenant rows cascades to users/conversations/documents in tenant A & B.
    // The GLOBAL-tenant document is NOT under those tenants, so remove it explicitly
    // (under admin context, since a normal context could not have written it).
    await asCtx({ tenantId: GLOBAL_TENANT_ID, isAdmin: true }, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM documents WHERE id = $1::uuid`, docGlobal),
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = ANY($1::uuid[])`,
      [tenantA, tenantB],
    );
    await prisma.$disconnect();
  });

  describe("tenant_isolation (tenant_only: users)", () => {
    it("a tenant reads its own row", async () => {
      expect(await countByIds({ tenantId: tenantA }, "users", [userA1])).toBe(1);
    });

    it("a tenant CANNOT read another tenant's row", async () => {
      expect(await countByIds({ tenantId: tenantB }, "users", [userA1])).toBe(0);
    });

    it("fails closed: no context set sees no rows", async () => {
      // A bare query (no transaction, no GUCs) — current_setting returns '' → NULL →
      // the USING predicate is never true, so the row is invisible.
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])`,
        [userA1, userA2, userB1],
      );
      expect(rows[0]?.n).toBe(0);
    });

    it("admin context bypasses tenant scoping (reads across tenants)", async () => {
      expect(
        await countByIds({ tenantId: tenantA, isAdmin: true }, "users", [
          userA1,
          userB1,
        ]),
      ).toBe(2);
    });

    it("WITH CHECK blocks inserting a row for another tenant", async () => {
      await expect(
        asCtx({ tenantId: tenantA }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO users (id, tenant_id, firebase_uid, email, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, now())`,
            randomUUID(),
            tenantB, // foreign tenant — must be rejected under tenant A's context
            `fb-evil-${tag}`,
            `evil-${tag}@t.test`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe("tenant_user_isolation (user_scoped: conversations)", () => {
    it("the owning user reads their own conversation", async () => {
      expect(
        await countByIds(
          { tenantId: tenantA, userId: userA1 },
          "conversations",
          [convoA1],
        ),
      ).toBe(1);
    });

    it("a different user in the SAME tenant cannot read it", async () => {
      expect(
        await countByIds(
          { tenantId: tenantA, userId: userA2 },
          "conversations",
          [convoA1],
        ),
      ).toBe(0);
    });

    it("a user in another tenant cannot read it", async () => {
      expect(
        await countByIds(
          { tenantId: tenantB, userId: userB1 },
          "conversations",
          [convoA1],
        ),
      ).toBe(0);
    });

    it("admin context reads any user's conversation", async () => {
      expect(
        await countByIds(
          { tenantId: tenantA, isAdmin: true },
          "conversations",
          [convoA1],
        ),
      ).toBe(1);
    });

    it("WITH CHECK blocks inserting a conversation for another user", async () => {
      await expect(
        asCtx({ tenantId: tenantA, userId: userA1 }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO conversations (id, tenant_id, user_id, title, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now())`,
            randomUUID(),
            tenantA,
            userA2, // not the acting user — must be rejected
            `forged ${tag}`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe("tenant_write + global_read (knowledge: documents)", () => {
    it("a tenant reads its own document", async () => {
      expect(await countByIds({ tenantId: tenantA }, "documents", [docA])).toBe(1);
    });

    it("another tenant CANNOT read a tenant-scoped document", async () => {
      expect(await countByIds({ tenantId: tenantB }, "documents", [docA])).toBe(0);
    });

    it("any tenant CAN read a GLOBAL-tenant document (global_read)", async () => {
      expect(
        await countByIds({ tenantId: tenantB }, "documents", [docGlobal]),
      ).toBe(1);
    });

    it("WITH CHECK blocks writing a document for another tenant", async () => {
      await expect(
        asCtx({ tenantId: tenantA }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO documents (id, tenant_id, title, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, now())`,
            randomUUID(),
            tenantB,
            `cross ${tag}`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("global_read is read-only: a tenant cannot write into the GLOBAL tenant", async () => {
      await expect(
        asCtx({ tenantId: tenantB }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO documents (id, tenant_id, title, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, now())`,
            randomUUID(),
            GLOBAL_TENANT_ID, // tenant_write WITH CHECK requires tenant_id = current
            `sneaky-global ${tag}`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
