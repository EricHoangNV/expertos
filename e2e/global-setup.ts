import { request as playwrightRequest } from "@playwright/test";
import { applyRlsContext, GLOBAL_TENANT_ID, PrismaClient, type Role } from "@expertos/db";
import { getEmulatorIdToken } from "./fixtures/auth";
import { env, users, type TestUser } from "./fixtures/env";

/**
 * Playwright global setup — the "out-of-band" stack preparation the README documents
 * (E2E, M11.1). It makes the deterministic test identities resolvable with the roles the
 * gated portal flows assert, so the suite is repeatable against a freshly-seeded stack:
 *
 *   1. Sign each test identity in against the Auth **emulator** and hit `GET /me`, so the
 *      API mirrors a local user row (it keys on `firebase_uid`, assigned by the emulator —
 *      see `AuthService.resolveUser`). This is the only way to learn the uid, so roles must
 *      be promoted *after* the row exists, not pre-seeded by email.
 *   2. Promote `e2e-expert@` → `expert` and `e2e-admin@` → `admin` directly in the database,
 *      since there is no pre-existing admin to authorize `PATCH /admin/users/:id/role`
 *      (the bootstrap problem). The write goes through the app's own RLS helper under an
 *      admin context, so it works whether `DATABASE_URL` connects as the owner or as the
 *      FORCE-RLS `app_user` role.
 *
 * Idempotent: re-running against an already-prepared stack is a no-op (find-or-mirror +
 * upsert-by-email role). Reads `DATABASE_URL` (the same URL the API uses); skips the role
 * promotion with a clear warning if it is unset.
 */
async function globalSetup(): Promise<void> {
  const ctx = await playwrightRequest.newContext();
  try {
    // 1. Mirror every identity's user row by exercising an authenticated endpoint.
    for (const user of Object.values(users) as TestUser[]) {
      const token = await getEmulatorIdToken(ctx, user);
      const res = await ctx.get(`${env.apiBaseUrl}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok()) {
        throw new Error(
          `global-setup: GET /me failed for ${user.email} (${res.status()}). Is the API up at ${env.apiBaseUrl}?`,
        );
      }
    }
  } finally {
    await ctx.dispose();
  }

  // 2. Promote the privileged identities. The role enum is user | expert | admin.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      "global-setup: DATABASE_URL unset — skipping role promotion. The admin/expert portal " +
        "specs will fail until e2e-admin@/e2e-expert@ are granted their roles out-of-band.",
    );
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const promotions: Array<{ email: string; role: Role }> = [
      { email: users.admin.email, role: "admin" },
      { email: users.expert.email, role: "expert" },
    ];
    await prisma.$transaction(async (tx) => {
      // Admin context: the role update must not be tenant-scoped (mirrors AuthService).
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
      for (const { email, role } of promotions) {
        const updated = await tx.user.updateMany({ where: { email }, data: { role } });
        if (updated.count === 0) {
          throw new Error(
            `global-setup: no user row to promote for ${email} — sign-in mirroring (step 1) did not create it.`,
          );
        }
      }

      // Put the consumer member on the Plus plan so the question/upload flows don't hit the
      // Free plan's monthly hard cap across repeated runs (Plus: 200 questions/mo + document
      // upload). Plus is deliberately not the top tier, so the account-billing self-serve
      // upgrade CTA (→ Premium) still renders. Idempotent: only create if none is active.
      const member = await tx.user.findFirst({ where: { email: users.member.email } });
      const plus = await tx.plan.findUnique({ where: { key: "plus" } });
      if (member && plus) {
        const existing = await tx.subscription.findFirst({
          where: { userId: member.id, status: "active" },
        });
        if (!existing) {
          await tx.subscription.create({
            data: {
              userId: member.id,
              planId: plus.id,
              status: "active",
              currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }

      // Seed one active expert with a *published* English voice profile so the M2.2 voice
      // picker has a non-neutral option and the chat voice layer resolves a profile. Without
      // it the `web-voice-and-consultation` "AI rendition" test skips (the picker offers only
      // the neutral voice). Eligibility mirrors `PgExpertStore`/`PgVoiceExampleStore`: the
      // expert must be `active` and the profile `published` in the requested language (`en`).
      // Idempotent: upsert the expert by (tenant, slug); create the profile only if absent.
      // Linked to the e2e-expert@ identity so the expert portal flows see a real expert too.
      const expertUser = await tx.user.findFirst({ where: { email: users.expert.email } });
      const admin = await tx.user.findFirst({ where: { email: users.admin.email } });
      const expert = await tx.expert.upsert({
        where: { tenantId_slug: { tenantId: GLOBAL_TENANT_ID, slug: "e2e-expert" } },
        update: { active: true },
        create: {
          tenantId: GLOBAL_TENANT_ID,
          slug: "e2e-expert",
          displayName: "Dr. Ada Mentor",
          title: "Lead Expert",
          active: true,
          userId: expertUser?.id ?? null,
        },
      });
      const publishedProfile = await tx.voiceProfile.findFirst({
        where: { expertId: expert.id, language: "en", status: "published" },
      });
      if (!publishedProfile) {
        await tx.voiceProfile.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            expertId: expert.id,
            language: "en",
            name: "Ada — measured & practical",
            description: "E2E-seeded published voice profile.",
            guidelines:
              "Answer plainly and practically. Lead with the bottom line, then the reasoning. " +
              "Stay grounded in the provided sources; never claim first-hand experience.",
            status: "published",
            approvedBy: admin?.id ?? null,
            approvedAt: new Date(),
          },
        });
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
