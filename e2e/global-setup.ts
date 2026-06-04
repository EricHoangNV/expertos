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
/**
 * Extract the uid from an emulator ID token. Emulator tokens are unsigned JWTs (`alg: none`); the
 * uid is the `user_id` (Firebase) / `sub` claim in the base64url payload.
 */
function decodeEmulatorUid(idToken: string): string {
  const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8")) as {
    user_id?: string;
    sub?: string;
  };
  const uid = payload.user_id ?? payload.sub;
  if (!uid) throw new Error("global-setup: emulator token carried no user_id/sub claim.");
  return uid;
}

async function globalSetup(): Promise<void> {
  // The Auth emulator is in-memory, so a restart reassigns every identity a new uid while the DB still
  // holds the prior session's uid for that email. `AuthService.resolveUser` keys on uid → it can't find
  // the row, tries to create a new one, and hits the email unique constraint (GET /me → 500). Repoint
  // the existing row to the current uid (by email, admin RLS context) before mirroring, so /me resolves
  // it. A short-lived client just for this reconcile — step 2 opens its own for the role promotions.
  const reconcileUrl = process.env.DATABASE_URL;
  const reconcilePrisma = reconcileUrl
    ? new PrismaClient({ datasources: { db: { url: reconcileUrl } } })
    : null;
  const ctx = await playwrightRequest.newContext();
  try {
    // 1. Mirror every identity's user row by exercising an authenticated endpoint.
    for (const user of Object.values(users) as TestUser[]) {
      const token = await getEmulatorIdToken(ctx, user);
      if (reconcilePrisma) {
        const uid = decodeEmulatorUid(token);
        await reconcilePrisma.$transaction(async (tx) => {
          await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
          await tx.user.updateMany({
            where: { email: user.email, firebaseUid: { not: uid } },
            data: { firebaseUid: uid },
          });
        });
      }
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
    await reconcilePrisma?.$disconnect();
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

        // The admin portal gates sign-in on the M14 access-control whitelist (`allowed_emails`):
        // `POST /me/admin-session` denies any email not on it (and *syncs* the DB role from it, so
        // the whitelist is the real source of truth for portal roles). Only the bootstrap admin is
        // seeded, so without this the e2e-admin@/e2e-expert@ identities hit the Access Denied screen
        // and every portal spec fails. Upsert them here, in the same admin-context transaction.
        await tx.allowedEmail.upsert({
          where: { tenantId_email: { tenantId: GLOBAL_TENANT_ID, email } },
          update: { role },
          create: { tenantId: GLOBAL_TENANT_ID, email, role },
        });
      }

      // Reset every test identity's persisted locale to English. The i18n specs (M15.3.1/.6)
      // toggle to Vietnamese and persist it to the profile (`PATCH /me/locale`); without this
      // reset a prior run leaves a VI profile that seeds the next run's UI, breaking the English
      // baseline assertions. localStorage starts clean per browser context, so profile is the
      // only cross-run locale carrier — pin it back to the deterministic default here.
      await tx.user.updateMany({
        where: { email: { in: Object.values(users).map((u) => u.email) } },
        data: { locale: "en" },
      });

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
      // The Ada expert is the anchor for the voice-picker (M2.2) + concierge flows. global-teardown
      // deletes it each run, so this normally hits the create branch — but restore its identity in the
      // update branch too, so Ada is always present and correctly named even if teardown was skipped
      // (e.g. DATABASE_URL unset) or the row otherwise lingers.
      const expert = await tx.expert.upsert({
        where: { tenantId_slug: { tenantId: GLOBAL_TENANT_ID, slug: "e2e-expert" } },
        update: {
          active: true,
          displayName: "Dr. Ada Mentor",
          title: "Lead Expert",
          userId: expertUser?.id ?? null,
        },
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

      // Seed one document parked in **Expert Review** so the M13.3 knowledge-approval kanban
      // (M15.3.4) has a real card to approve → publish. The board lists/counts by `document.status`,
      // so both the document and its latest version sit at `expert_review`. Reset to that state every
      // run (a prior approve published it), so the approve round-trip is repeatable. Found by title
      // within the tenant (documents carry no natural unique key); `version_number` is unique per doc.
      const KNOWLEDGE_TITLE = "E2E Expert-Review Note";
      const existingDoc = await tx.document.findFirst({
        where: { tenantId: GLOBAL_TENANT_ID, title: KNOWLEDGE_TITLE },
        select: { id: true },
      });
      const knowledgeDoc = existingDoc
        ? await tx.document.update({
            where: { id: existingDoc.id },
            // Clear the published pointer before re-parking the version at expert_review.
            data: { status: "expert_review", publishedVersionId: null, expertId: expert.id },
            select: { id: true },
          })
        : await tx.document.create({
            data: {
              tenantId: GLOBAL_TENANT_ID,
              title: KNOWLEDGE_TITLE,
              scope: "global_expert",
              language: "en",
              status: "expert_review",
              expertId: expert.id,
            },
            select: { id: true },
          });
      const existingVersion = await tx.documentVersion.findFirst({
        where: { documentId: knowledgeDoc.id, versionNumber: 1 },
        select: { id: true },
      });
      if (existingVersion) {
        await tx.documentVersion.update({
          where: { id: existingVersion.id },
          data: { status: "expert_review", approvedBy: null, approvedAt: null },
        });
      } else {
        await tx.documentVersion.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            documentId: knowledgeDoc.id,
            versionNumber: 1,
            status: "expert_review",
            changeSummary: "Initial E2E draft for the approval round-trip.",
          },
        });
      }

      // Seed one concierge review case in the expert's voice so the M9.2 review queue (M15.3.3) has
      // a real `requested` item to open + record a verdict on. The queue is voice-scoped via
      // `message.conversation.expertId`, so the conversation is owned by the member but pinned to the
      // seeded expert. Wipe + recreate the fixture conversation every run (cascade clears its
      // messages → review request → responses, plus any refined message a prior `respond` appended),
      // so the queue starts from a single open item. Found by the member + expert + marker title.
      if (member) {
        const CONCIERGE_TITLE = "E2E Concierge Review Case";
        await tx.conversation.deleteMany({
          where: { userId: member.id, expertId: expert.id, title: CONCIERGE_TITLE },
        });
        const convo = await tx.conversation.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            userId: member.id,
            expertId: expert.id,
            title: CONCIERGE_TITLE,
            language: "en",
          },
          select: { id: true },
        });
        const now = Date.now();
        // The detail pane resolves the question as the latest user message at/<= the answer's time,
        // so the question must be stamped earlier than the answer.
        await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: convo.id,
            role: "user",
            content: "How should I price a monthly retainer for a new consulting client?",
            createdAt: new Date(now - 2000),
          },
        });
        const answer = await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: convo.id,
            role: "assistant",
            content:
              "A common approach is to estimate the monthly hours, apply your blended rate, then add " +
              "a retainer premium for priority access. E2E concierge fixture answer.",
            confidence: 0.4,
            createdAt: new Date(now - 1000),
          },
          select: { id: true },
        });
        await tx.humanReviewRequest.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            userId: member.id,
            messageId: answer.id,
            triggerMode: "auto_silent",
            visibility: "silent",
            confidenceScore: 0.4,
            status: "requested",
            slaDueAt: new Date(now + 24 * 60 * 60 * 1000),
          },
        });

        // Seed a member-owned conversation containing an expert-*refined* answer, so the
        // consumer-facing concierge disclosure (OD#5 / M9.0) renders in /history. That badge keys
        // solely on `Message.refinedFromMessageId` (a delivered, reviewer-edited answer points back
        // at the original), so the minimal faithful fixture is two assistant messages where the
        // second refines the first. Wipe + recreate every run for a deterministic single case.
        const REVIEWED_TITLE = "E2E Reviewed Answer Case";
        await tx.conversation.deleteMany({ where: { userId: member.id, title: REVIEWED_TITLE } });
        const reviewedConvo = await tx.conversation.create({
          data: { tenantId: GLOBAL_TENANT_ID, userId: member.id, title: REVIEWED_TITLE, language: "en" },
          select: { id: true },
        });
        const rNow = Date.now();
        await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: reviewedConvo.id,
            role: "user",
            content: "Reviewed-case question for the disclosure badge.",
            createdAt: new Date(rNow - 3000),
          },
        });
        const reviewedOriginal = await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: reviewedConvo.id,
            role: "assistant",
            content: "Original AI answer before expert review.",
            createdAt: new Date(rNow - 2000),
          },
          select: { id: true },
        });
        await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: reviewedConvo.id,
            role: "assistant",
            content: "Refined answer delivered after expert review. E2E reviewed disclosure fixture.",
            refinedFromMessageId: reviewedOriginal.id,
            createdAt: new Date(rNow - 1000),
          },
        });

        // Seed a conversation-sourced KnowledgeDraft so the admin Knowledge page's
        // "Conversation → Knowledge" table (M8.2) has a real "From chat: yes" row to assert. The
        // pipeline has no UI promote button — the "marked valuable" state is represented purely by a
        // KnowledgeDraft row whose `conversationId` is set. Wipe + recreate by title each run.
        const KD_TITLE = "E2E Recurring Question Draft";
        let kdConvo = await tx.conversation.findFirst({
          where: { userId: member.id, title: "E2E Knowledge Source Convo" },
          select: { id: true },
        });
        if (!kdConvo) {
          kdConvo = await tx.conversation.create({
            data: { tenantId: GLOBAL_TENANT_ID, userId: member.id, title: "E2E Knowledge Source Convo", language: "en" },
            select: { id: true },
          });
        }
        await tx.knowledgeDraft.deleteMany({ where: { tenantId: GLOBAL_TENANT_ID, title: KD_TITLE } });
        await tx.knowledgeDraft.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: kdConvo.id,
            expertId: expert.id,
            title: KD_TITLE,
            content: "Seeded conversation-sourced draft for the M8.2 admin surface.",
            language: "en",
            status: "draft",
          },
        });
      }

      // Seed a second voice profile parked at **expert_review** so the expert can Approve→publish it
      // (M2.3 / M13.5): from expert_review a single "Approve" publishes the voice. Reset to
      // expert_review every run (a prior run's Approve published it), mirroring the knowledge-doc reset.
      const SIGNOFF_VOICE_NAME = "Ada — awaiting sign-off";
      const signoffVoice = await tx.voiceProfile.findFirst({
        where: { expertId: expert.id, name: SIGNOFF_VOICE_NAME },
        select: { id: true },
      });
      if (signoffVoice) {
        await tx.voiceProfile.update({
          where: { id: signoffVoice.id },
          data: { status: "expert_review", approvedBy: null, approvedAt: null },
        });
      } else {
        await tx.voiceProfile.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            expertId: expert.id,
            language: "en",
            name: SIGNOFF_VOICE_NAME,
            description: "E2E-seeded profile awaiting expert sign-off.",
            guidelines: "Be concise and practical.",
            status: "expert_review",
          },
        });
      }

      // Seed a dedicated throwaway user *with owned data* so the M8.4 irreversible deletion
      // cascade (M15.3.5) has a real target the spec can permanently delete + verify gone —
      // without ever touching a shared test identity. DB-only on purpose: the admin deletes it
      // by row, so it needs no emulator identity and the spec never signs in as it. The prior
      // run's spec deletes it, so re-create it every run for a repeatable round-trip; the fixed
      // `firebase_uid` keeps the upsert stable. A conversation + message give the cascade owned
      // data to remove (and the detail page a non-zero conversation stat the spec asserts
      // pre-delete, so the test can't pass vacuously against a dataless user).
      const DELETABLE_EMAIL = "e2e-deletable@expertos.test";
      const deletable = await tx.user.upsert({
        where: { tenantId_email: { tenantId: GLOBAL_TENANT_ID, email: DELETABLE_EMAIL } },
        update: {},
        create: {
          tenantId: GLOBAL_TENANT_ID,
          firebaseUid: "e2e-deletable-uid",
          email: DELETABLE_EMAIL,
          displayName: "E2E Deletable User",
          role: "user",
        },
        select: { id: true },
      });
      const deletableConvo = await tx.conversation.findFirst({
        where: { userId: deletable.id },
        select: { id: true },
      });
      if (!deletableConvo) {
        const convo = await tx.conversation.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            userId: deletable.id,
            title: "E2E Deletable User Conversation",
            language: "en",
          },
          select: { id: true },
        });
        await tx.message.create({
          data: {
            tenantId: GLOBAL_TENANT_ID,
            conversationId: convo.id,
            role: "user",
            content: "A throwaway message the deletion cascade must remove.",
          },
        });
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
