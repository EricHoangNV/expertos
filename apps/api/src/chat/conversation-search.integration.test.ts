/**
 * Live integration tests for {@link ConversationService.search} (M11 — the deferred
 * "Testcontainers" pass for the M3.3 full-text conversation-search raw-SQL path).
 *
 * The unit suite mocks `$queryRawUnsafe`, so it can only prove the SQL *string* and bound
 * params are assembled correctly — it cannot prove Postgres actually (a) ranks hits by
 * `ts_rank` and breaks ties by recency, (b) returns a guillemet-delimited `ts_headline`
 * snippet (never HTML), (c) treats the query through the `'simple'` config so Vietnamese is
 * undistorted (OD #9), (d) picks the single strongest message via the `LATERAL` subquery, or
 * (e) honours RLS so the `user_scoped` `conversations` anchor keeps the search to the acting
 * user's own chats even though `messages` is `tenant_only`. This suite runs the real driver —
 * through the real {@link ConversationService} + {@link RlsService} so the RLS context is
 * derived exactly as in production — against a real Postgres to close those gaps.
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
import {
  applyRlsContext,
  PrismaClient,
  type RlsContext,
} from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { ConversationService } from "./conversation.service";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("ConversationService.search live integration (app_user role)", () => {
  let prisma: PrismaClient;
  let service: ConversationService;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA1 = randomUUID(); // tenant A, user 1 — owns the searchable conversations
  const userA2 = randomUUID(); // tenant A, user 2 — same tenant, a different owner
  const userB1 = randomUUID(); // tenant B, user 1 — another tenant entirely

  // Conversations owned by userA1.
  const convoMsg = randomUUID(); // "photosynthesis" matches in a message (snippet + messageId)
  const convoTitleOnly = randomUUID(); // "photosynthesis" matches the TITLE only (snippet/messageId null)
  const convoVi = randomUUID(); // Vietnamese message body
  const convoRankOld = randomUUID(); // identical "quantum" match, older updated_at
  const convoRankNew = randomUUID(); // identical "quantum" match, newer updated_at
  // Owned by a different user in the same tenant — must stay invisible to userA1's search.
  const convoOtherUser = randomUUID();

  /** The conversations userA1 should ever be able to see. */
  const myConvoIds = new Set<string>([
    convoMsg,
    convoTitleOnly,
    convoVi,
    convoRankOld,
    convoRankNew,
  ]);

  function authUser(id: string, tenantId: string): AuthUser {
    return {
      id,
      tenantId,
      firebaseUid: `fb-${id}`,
      email: `${id}@t.test`,
      displayName: null,
      role: "user",
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
    service = new ConversationService(new RlsService(prisma));

    // tenants has no RLS — seed the two test tenants directly as app_user.
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES
         ($1::uuid, $2, $3, now()), ($4::uuid, $5, $6, now())`,
      tenantA, `cs-a-${tag}`, `CS A ${tag}`,
      tenantB, `cs-b-${tag}`, `CS B ${tag}`,
    );

    // Everything else is RLS-protected. Seed under an admin context (is_admin bypasses the
    // WITH CHECK) so we can write rows for several users/tenants in one pass — exactly the
    // cross-user write a normal context cannot do.
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

      const insertConvo = (
        id: string,
        userId: string,
        tenantId: string,
        title: string,
        language: string,
        updatedAt: string,
      ) =>
        tx.$executeRawUnsafe(
          `INSERT INTO conversations (id, tenant_id, user_id, title, language, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::language, $6::timestamptz, $6::timestamptz)`,
          id, tenantId, userId, title, language, updatedAt,
        );

      const insertMsg = (
        conversationId: string,
        tenantId: string,
        role: string,
        content: string,
      ) =>
        tx.$executeRawUnsafe(
          `INSERT INTO messages (id, tenant_id, conversation_id, role, content, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::message_role, $5, now())`,
          randomUUID(), tenantId, conversationId, role, content.normalize("NFC"),
        );

      // (1) message-body match for "photosynthesis".
      await insertConvo(convoMsg, userA1, tenantA, "Garden questions", "en", "2026-01-01T00:00:00Z");
      await insertMsg(convoMsg, tenantA, "user", "How does photosynthesis happen in leaves?");
      await insertMsg(convoMsg, tenantA, "assistant", "Photosynthesis converts sunlight into chemical energy in chloroplasts.");

      // (2) title-only match for "photosynthesis" — its messages never mention it.
      await insertConvo(convoTitleOnly, userA1, tenantA, "Photosynthesis deep dive", "en", "2026-01-02T00:00:00Z");
      await insertMsg(convoTitleOnly, tenantA, "user", "Tell me about ocean currents instead.");
      await insertMsg(convoTitleOnly, tenantA, "assistant", "Ocean currents redistribute heat across the planet.");

      // (3) Vietnamese body — 'simple' config + NFC keep the diacritics intact (OD #9).
      await insertConvo(convoVi, userA1, tenantA, "Lịch sử thế giới", "vi", "2026-01-03T00:00:00Z");
      await insertMsg(convoVi, tenantA, "user", "Hiệp ước hòa bình được ký kết tại Wien.");
      await insertMsg(convoVi, tenantA, "assistant", "Đó là một sự kiện quan trọng.");

      // (4) two identical "quantum" matches differing only by updated_at → recency tiebreak.
      await insertConvo(convoRankOld, userA1, tenantA, "notes one", "en", "2026-02-01T00:00:00Z");
      await insertMsg(convoRankOld, tenantA, "assistant", "Quantum entanglement links distant particles.");
      await insertConvo(convoRankNew, userA1, tenantA, "notes two", "en", "2026-02-02T00:00:00Z");
      await insertMsg(convoRankNew, tenantA, "assistant", "Quantum entanglement links distant particles.");

      // (5) a "photosynthesis" conversation owned by a DIFFERENT user in the same tenant.
      await insertConvo(convoOtherUser, userA2, tenantA, "Photosynthesis secret", "en", "2026-03-01T00:00:00Z");
      await insertMsg(convoOtherUser, tenantA, "assistant", "Photosynthesis is the engine of life.");
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Deleting the tenants cascades to users → conversations → messages (all ON DELETE CASCADE).
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = ANY($1::uuid[])`,
      [tenantA, tenantB],
    );
    await prisma.$disconnect();
  });

  it("matches a message body and returns a guillemet snippet + messageId", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: "photosynthesis",
      limit: 20,
      offset: 0,
    });

    const hit = res.find((r) => r.conversation.id === convoMsg);
    expect(hit).toBeDefined();
    expect(hit?.messageId).not.toBeNull();
    // The snippet is delimited with guillemets, never HTML (directive §1).
    expect(hit?.snippet).toContain("«");
    expect(hit?.snippet).toContain("»");
    expect(hit?.snippet).not.toMatch(/<\/?b>/i);
    expect(hit?.snippet?.toLowerCase()).toContain("photosynthesis");
  });

  it("matches on the title alone with a null snippet + null messageId", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: "photosynthesis",
      limit: 20,
      offset: 0,
    });

    const hit = res.find((r) => r.conversation.id === convoTitleOnly);
    expect(hit).toBeDefined();
    expect(hit?.messageId).toBeNull();
    expect(hit?.snippet).toBeNull();
  });

  it("does NOT see another user's conversation in the same tenant (user_scoped anchor)", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: "photosynthesis",
      limit: 20,
      offset: 0,
    });
    expect(res.some((r) => r.conversation.id === convoOtherUser)).toBe(false);
    // Every returned conversation belongs to userA1.
    expect(res.every((r) => myConvoIds.has(r.conversation.id))).toBe(true);
  });

  it("breaks rank ties by most-recent activity", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: "quantum",
      limit: 20,
      offset: 0,
    });
    const ids = res.map((r) => r.conversation.id);
    expect(ids).toContain(convoRankOld);
    expect(ids).toContain(convoRankNew);
    // Identical ts_rank → ORDER BY ... c.updated_at DESC puts the newer one first.
    expect(ids.indexOf(convoRankNew)).toBeLessThan(ids.indexOf(convoRankOld));
  });

  it("matches Vietnamese terms through the 'simple' config (NFC-normalized)", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: "hòa bình".normalize("NFC"),
      limit: 20,
      offset: 0,
    });
    const hit = res.find((r) => r.conversation.id === convoVi);
    expect(hit).toBeDefined();
    expect(hit?.messageId).not.toBeNull();
    expect(hit?.snippet).toContain("«");
  });

  it("honours limit and offset pagination", async () => {
    const user = authUser(userA1, tenantA);
    const page1 = await service.search(user, { q: "quantum", limit: 1, offset: 0 });
    const page2 = await service.search(user, { q: "quantum", limit: 1, offset: 1 });

    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0]?.conversation.id).not.toBe(page2[0]?.conversation.id);
    // Page 1 is the newer conversation (recency tiebreak); page 2 is the older one.
    expect(page1[0]?.conversation.id).toBe(convoRankNew);
    expect(page2[0]?.conversation.id).toBe(convoRankOld);
  });

  it("returns no hits for a term that appears nowhere", async () => {
    const res = await service.search(authUser(userA1, tenantA), {
      q: `zzznonexistent${tag}`,
      limit: 20,
      offset: 0,
    });
    expect(res).toEqual([]);
  });

  it("a user in another tenant sees none of these conversations", async () => {
    const res = await service.search(authUser(userB1, tenantB), {
      q: "photosynthesis",
      limit: 20,
      offset: 0,
    });
    expect(res.some((r) => myConvoIds.has(r.conversation.id))).toBe(false);
  });
});
