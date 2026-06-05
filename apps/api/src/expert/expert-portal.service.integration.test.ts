/**
 * Live integration tests for {@link ExpertPortalService} (M11 — the deferred "Testcontainers" pass
 * for the M8.5 expert-portal reads: the `groupBy` conversions aggregate and the raw-SQL `LATERAL`
 * answer-review feed).
 *
 * The unit suite mocks the transaction, so it can prove the query *shape* but not that Postgres
 * actually (a) runs the elevated-but-bounded read — the `is_admin` GUC grants the cross-user read
 * while the explicit `tenant_id` + `conversation.expert_id` predicates keep it voice-scoped (the
 * architectural crux: a non-admin expert must see ONLY their own voice's funnel, never a peer
 * expert's in the same tenant), (b) aggregates recommendations/consultations by trigger/response/
 * status with `_sum(amount_cents)` revenue, or (c) `LATERAL`-joins each assistant message to its
 * prompting question + latest feedback and derives the insufficient-knowledge flag. This suite runs
 * the real service against a real Postgres to close those gaps.
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
  type RlsContext,
} from "@expertos/db";
import type { AuthUser } from "../auth/auth.types";
import { ExpertPortalService } from "./expert-portal.service";

const RLS_TEST_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL;
const describeLive = RLS_TEST_DATABASE_URL ? describe : describe.skip;

describeLive("ExpertPortalService live integration (app_user role)", () => {
  let prisma: PrismaClient;
  let service: ExpertPortalService;

  const tag = randomUUID().slice(0, 8);
  const tenantA = randomUUID();

  // Two experts in the same tenant — the isolation crux is that E1 never sees E2's funnel.
  const e1 = randomUUID();
  const e2 = randomUUID();
  const userExpert1 = randomUUID(); // linked operator account for E1 (role "expert")
  const userCustomer = randomUUID(); // a customer with no linked expert
  const custC1 = randomUUID(); // end user whose conversations are held in E1's voice
  const custC2 = randomUUID(); // end user whose conversations are held in E2's voice

  const convE1 = randomUUID(); // expertId = E1
  const convE2 = randomUUID(); // expertId = E2
  const qMsg = randomUUID(); // user question in convE1
  const ansGrounded = randomUUID(); // assistant, grounded, 👍 feedback
  const ansInsufficient = randomUUID(); // assistant, empty source_version_ids
  const ansE2 = randomUUID(); // assistant in convE2 — must be invisible to E1

  const rec1 = randomUUID(); // convE1: topic / book → booked consultation
  const rec2 = randomUUID(); // convE1: depth / maybe_later
  const recE2 = randomUUID(); // convE2: topic / book — must NOT count for E1
  const cons1 = randomUUID(); // booked, 5000 cents
  const dvId = randomUUID();

  function authUser(id: string, role: "user" | "expert" | "admin"): AuthUser {
    return {
      id,
      tenantId: tenantA,
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
    service = new ExpertPortalService(prisma, {
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as ConstructorParameters<typeof ExpertPortalService>[1]);

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants (id, slug, name, updated_at) VALUES ($1::uuid, $2, $3, now())`,
      tenantA, `ep-${tag}`, `EP ${tag}`,
    );

    await asCtx({ tenantId: tenantA, isAdmin: true }, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, tenant_id, firebase_uid, email, role, updated_at) VALUES
           ($1::uuid, $2::uuid, $3, $4, 'expert'::role, now()),
           ($5::uuid, $2::uuid, $6, $7, 'user'::role, now()),
           ($8::uuid, $2::uuid, $9, $10, 'user'::role, now()),
           ($11::uuid, $2::uuid, $12, $13, 'user'::role, now())`,
        userExpert1, tenantA, `fb-e1-${tag}`, `e1-${tag}@t.test`,
        userCustomer, `fb-cust-${tag}`, `cust-${tag}@t.test`,
        custC1, `fb-c1-${tag}`, `c1-${tag}@t.test`,
        custC2, `fb-c2-${tag}`, `c2-${tag}@t.test`,
      );

      // E1 is linked to userExpert1; E2 has no operator account.
      await tx.$executeRawUnsafe(
        `INSERT INTO experts (id, tenant_id, user_id, slug, display_name, active, updated_at) VALUES
           ($1::uuid, $2::uuid, $3::uuid, $4, $5, true, now()),
           ($6::uuid, $2::uuid, NULL, $7, $8, true, now())`,
        e1, tenantA, userExpert1, `e1-${tag}`, "Expert One",
        e2, `e2-${tag}`, "Expert Two",
      );

      const insertConvo = (id: string, userId: string, expertId: string) =>
        tx.$executeRawUnsafe(
          `INSERT INTO conversations (id, tenant_id, user_id, expert_id, title, language, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'en'::language, now(), now())`,
          id, tenantA, userId, expertId, "chat",
        );
      await insertConvo(convE1, custC1, e1);
      await insertConvo(convE2, custC2, e2);

      // convE1 messages: question (T-30), grounded answer (T-20), insufficient answer (T-10).
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'user'::message_role, $4, now() - interval '30 seconds')`,
        qMsg, tenantA, convE1, "What is the best soil mix?",
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, model, confidence, source_version_ids, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, $5, $6, ARRAY[$7::uuid], now() - interval '20 seconds')`,
        ansGrounded, tenantA, convE1, "Use a loam-based mix.", "echo-dev", 0.9, dvId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, now() - interval '10 seconds')`,
        ansInsufficient, tenantA, convE1, "I don't have enough knowledge.",
      );
      // convE2 message — E1 must never see this.
      await tx.$executeRawUnsafe(
        `INSERT INTO messages (id, tenant_id, conversation_id, role, content, source_version_ids, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant'::message_role, $4, ARRAY[$5::uuid], now())`,
        ansE2, tenantA, convE2, "Expert Two's answer.", dvId,
      );

      // 👍 feedback on the grounded answer.
      await tx.$executeRawUnsafe(
        `INSERT INTO answer_feedback (id, tenant_id, user_id, message_id, helpful, reason, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true, $5, now())`,
        randomUUID(), tenantA, custC1, ansGrounded, "Very helpful",
      );

      // A booked consultation worth 5000 cents (custC1), linked to rec1.
      await tx.$executeRawUnsafe(
        `INSERT INTO consultations (id, tenant_id, user_id, status, amount_cents, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'booked'::consultation_status, 5000, now(), now())`,
        cons1, tenantA, custC1,
      );

      const insertRec = (
        id: string,
        userId: string,
        conversationId: string,
        consultationId: string | null,
        trigger: string,
        response: string,
      ) =>
        tx.$executeRawUnsafe(
          `INSERT INTO consultation_recommendations
             (id, tenant_id, user_id, conversation_id, consultation_id, trigger, response, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::recommendation_trigger, $7::recommendation_response, now())`,
          id, tenantA, userId, conversationId, consultationId, trigger, response,
        );

      await insertRec(rec1, custC1, convE1, cons1, "topic", "book");
      await insertRec(rec2, custC1, convE1, null, "depth", "maybe_later");
      await insertRec(recE2, custC2, convE2, null, "topic", "book");
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = $1::uuid`,
      tenantA,
    );
    await prisma.$disconnect();
  });

  it("aggregates one expert's conversions (voice-scoped, with booked revenue)", async () => {
    const expert = authUser(userExpert1, "expert");
    const res = await service.conversions(expert, null);

    expect(res.expert?.id).toBe(e1);
    // Two recommendations on E1's conversations — recE2 (E2's) must NOT count.
    expect(res.recommendationCount).toBe(2);
    expect(res.byTrigger.topic).toBe(1);
    expect(res.byTrigger.depth).toBe(1);
    expect(res.byResponse.book).toBe(1);
    expect(res.byResponse.maybe_later).toBe(1);
    // One booked consultation linked to rec1 → counted + revenue summed.
    expect(res.byConsultationStatus.booked).toBe(1);
    expect(res.revenueCents).toBe(5000);
    expect(res.recent).toHaveLength(2);
  });

  it("isolates a non-admin expert to their own voice (sees none of a peer's funnel)", async () => {
    // userExpert1 is linked to E1 only; E2's recommendation (recE2) and answer (ansE2) are a peer's.
    const expert = authUser(userExpert1, "expert");
    const conversions = await service.conversions(expert, null);
    expect(conversions.expert?.id).toBe(e1);
    // recE2 is topic/book on E2 — if it leaked, byTrigger.topic would be 2.
    expect(conversions.byTrigger.topic).toBe(1);

    const answers = await service.answers(expert, null, { limit: 100, offset: 0 });
    const ids = answers.map((a) => a.messageId);
    expect(ids).not.toContain(ansE2);
  });

  it("returns the LATERAL-joined answer feed for the expert's voice (question + feedback + flag)", async () => {
    const expert = authUser(userExpert1, "expert");
    const answers = await service.answers(expert, null, { limit: 100, offset: 0 });

    // Only E1's two assistant answers, newest-first (insufficient at T-10, grounded at T-20).
    expect(answers.map((a) => a.messageId)).toEqual([ansInsufficient, ansGrounded]);

    const grounded = answers.find((a) => a.messageId === ansGrounded);
    expect(grounded?.conversationId).toBe(convE1);
    expect(grounded?.question).toBe("What is the best soil mix?"); // LATERAL question
    expect(grounded?.model).toBe("echo-dev");
    expect(grounded?.confidence).toBeCloseTo(0.9, 5);
    expect(grounded?.insufficientKnowledge).toBe(false); // has provenance
    expect(grounded?.helpful).toBe(true); // LATERAL feedback
    expect(grounded?.feedbackReason).toBe("Very helpful");

    const insufficient = answers.find((a) => a.messageId === ansInsufficient);
    expect(insufficient?.insufficientKnowledge).toBe(true); // empty source_version_ids
    expect(insufficient?.helpful).toBeNull(); // no feedback row
    expect(insufficient?.question).toBe("What is the best soil mix?");
  });

  it("lets an admin target a specific expert via requestedExpertId", async () => {
    const admin = authUser(randomUUID(), "admin");
    const res = await service.conversions(admin, e2);
    expect(res.expert?.id).toBe(e2);
    // E2's single recommendation (recE2: topic / book).
    expect(res.recommendationCount).toBe(1);
    expect(res.byTrigger.topic).toBe(1);
    expect(res.byResponse.book).toBe(1);

    const answers = await service.answers(admin, e2, { limit: 100, offset: 0 });
    expect(answers.map((a) => a.messageId)).toEqual([ansE2]);
  });

  it("short-circuits to empty when no expert resolves (admin with no target / customer)", async () => {
    const admin = authUser(randomUUID(), "admin");
    const adminNoTarget = await service.conversions(admin, null);
    expect(adminNoTarget.expert).toBeNull();
    expect(adminNoTarget.recommendationCount).toBe(0);
    expect(await service.answers(admin, null, { limit: 100, offset: 0 })).toEqual([]);

    // A customer (no linked Expert row) resolves to no expert → empty, never a tenant-wide read.
    const customer = authUser(userCustomer, "user");
    const custConversions = await service.conversions(customer, null);
    expect(custConversions.expert).toBeNull();
    expect(custConversions.recommendationCount).toBe(0);
    expect(await service.answers(customer, null, { limit: 100, offset: 0 })).toEqual([]);
  });
});
