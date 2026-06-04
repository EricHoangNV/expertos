import { applyRlsContext, GLOBAL_TENANT_ID, PrismaClient } from "@expertos/db";
import { users } from "./fixtures/env";

/**
 * Playwright global teardown (DIRECTIVE #49 / §3.4.3 — "E2E suites self-provision AND self-clean").
 *
 * A run against the shared dev stack must leave it at baseline: `global-setup.ts` seeds deterministic,
 * namespaced fixtures, and this purges everything the suite owns afterwards. Idempotent setup dedups
 * *fixtures*, but it does nothing about the rows the specs create at runtime (conversations from every
 * chat turn, uploads, saved answers, whitelist entries) — without this teardown those accumulate on the
 * DB every run.
 *
 * Scope is **strictly the e2e namespace** — the `e2e-*@expertos.test` identities and `E2E `-prefixed
 * markers — never a broad date/status/tenant predicate that could touch real data. Deletes run in the
 * same admin-RLS-context transaction `global-setup.ts` uses, child→parent so no FK blocks (conversations
 * cascade messages/citations/review-requests/recommendations; documents cascade versions/chunks; the
 * expert cascades its voice profiles → examples).
 *
 * The Ada expert (`slug: e2e-expert`), its voice profiles, and metadata are deleted here and recreated
 * by `global-setup.ts` on the next run (the expert upsert + published-voice seed), so each run starts
 * from a clean, fully-reseeded baseline.
 *
 * The e2e identity *rows* themselves are intentionally kept: they are stable, deterministic anchors that
 * `global-setup.ts` re-mirrors via sign-in, and deleting a user is the app's own cascade concern
 * (AdminUserService — GCS object cleanup etc.), not a raw fixture delete. Reads `DATABASE_URL` (the URL
 * the API uses); skips with a warning if unset. Idempotent: re-running on an already-clean stack is a no-op.
 */
async function globalTeardown(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.warn("global-teardown: DATABASE_URL unset — skipping cleanup. The shared stack will retain this run's e2e data.");
    return;
  }

  const e2eEmails = Object.values(users).map((u) => u.email);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$transaction(async (tx) => {
      // Admin context: the cleanup spans the test identities, so it must not be tenant/user scoped.
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });

      // Resolve every e2e identity (the seeded four + any throwaway like e2e-deletable@ that lingers).
      const e2eUsers = await tx.user.findMany({
        where: { OR: [{ email: { in: e2eEmails } }, { email: { startsWith: "e2e-" } }] },
        select: { id: true },
      });
      const userIds = e2eUsers.map((u) => u.id);

      // 1. Content owned by the e2e identities. saved answers + uploads first (they reference messages),
      //    then conversations (which cascade messages → citations → review requests → recommendations).
      if (userIds.length > 0) {
        await tx.savedAnswer.deleteMany({ where: { userId: { in: userIds } } });
        await tx.uploadedFile.deleteMany({ where: { userId: { in: userIds } } });
        await tx.conversation.deleteMany({ where: { userId: { in: userIds } } });
        await tx.subscription.deleteMany({ where: { userId: { in: userIds } } });
      }

      // 2. Marker-tagged knowledge fixtures (documents cascade their versions → chunks).
      await tx.knowledgeDraft.deleteMany({ where: { title: { startsWith: "E2E " } } });
      await tx.document.deleteMany({ where: { title: { startsWith: "E2E " } } });

      // 3. Expert voice + metadata: the Ada expert and its voice profiles/examples. Conversations that
      //    referenced it are gone (step 1), so the expert delete won't hit an FK; deleting the expert
      //    cascades its voice profiles → examples (delete profiles explicitly first for clarity).
      const adaExpert = await tx.expert.findFirst({
        where: { tenantId: GLOBAL_TENANT_ID, slug: "e2e-expert" },
        select: { id: true },
      });
      if (adaExpert) {
        await tx.voiceProfile.deleteMany({ where: { expertId: adaExpert.id } });
        await tx.expert.delete({ where: { id: adaExpert.id } });
      }

      // 4. Whitelist entries for any e2e identity — the admin/expert seed AND throwaway emails a spec
      //    adds (e.g. access-control's `e2e-whitelist-temp@`). Every test email is `e2e-*`, and a real
      //    admin email never is, so the `e2e-` prefix is a safe, complete filter.
      await tx.allowedEmail.deleteMany({ where: { email: { startsWith: "e2e-" } } });
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default globalTeardown;
