/**
 * Idempotent seed: the GLOBAL tenant, the launch plans + prices, the entitlement
 * catalog, and the plan×feature matrix (PRD §"Paywall, Entitlements & Feature Gating").
 *
 * Runs as the schema owner (bypasses RLS). Quota cells are placeholders pending Open
 * Decision #4 (unit economics) and are admin-tunable without a deploy — this seed only
 * sets the defaults. Re-running is safe (upsert by natural key).
 */
import { PrismaClient } from "../generated/client";
import { GLOBAL_TENANT_ID } from "../src/rls";

const prisma = new PrismaClient();

const FEATURES = [
  { key: "ask_question", name: "Ask a question", type: "metered" as const },
  { key: "document_upload", name: "Document-upload Q&A", type: "boolean" as const },
  { key: "all_expert_voices", name: "All expert voices", type: "boolean" as const },
  { key: "cited_answers", name: "Cited answers + sources", type: "boolean" as const },
  { key: "saved_answers", name: "Saved answers & history", type: "metered" as const },
  { key: "concierge_review", name: "Concierge human review", type: "boolean" as const },
  { key: "consultation_booking", name: "Consultation recommend + book", type: "boolean" as const },
];

const PLANS = [
  { key: "free", name: "Free", sortOrder: 0, prices: [] as Array<{ interval: "month" | "year"; amountCents: number }> },
  { key: "plus", name: "Plus", sortOrder: 1, prices: [{ interval: "month" as const, amountCents: 499 }] },
  {
    key: "premium",
    name: "Premium",
    sortOrder: 2,
    prices: [
      { interval: "month" as const, amountCents: 999 },
      { interval: "year" as const, amountCents: 6999 },
    ],
  },
];

// plan key → feature key → entitlement. `limit: null` on a metered feature = no hard cap;
// `softLimit` is the fair-use threshold past which the answer degrades to a cheaper model
// instead of blocking (Premium "high fair-use cap → degrade, don't block"). Both admin-tunable.
type Cell = {
  enabled: boolean;
  limit?: number | null;
  softLimit?: number | null;
  window?: "day" | "week" | "month";
};
const MATRIX: Record<string, Record<string, Cell>> = {
  free: {
    ask_question: { enabled: true, limit: 5, window: "month" },
    document_upload: { enabled: false },
    all_expert_voices: { enabled: true },
    cited_answers: { enabled: true },
    saved_answers: { enabled: true, limit: 10, window: "month" },
    concierge_review: { enabled: false },
    consultation_booking: { enabled: true },
  },
  plus: {
    ask_question: { enabled: true, limit: 100, window: "month" },
    document_upload: { enabled: true },
    all_expert_voices: { enabled: true },
    cited_answers: { enabled: true },
    saved_answers: { enabled: true, limit: 100, window: "month" },
    concierge_review: { enabled: false },
    consultation_booking: { enabled: true },
  },
  premium: {
    ask_question: { enabled: true, limit: null, softLimit: 1000, window: "month" },
    document_upload: { enabled: true },
    all_expert_voices: { enabled: true },
    cited_answers: { enabled: true },
    saved_answers: { enabled: true, limit: null, window: "month" },
    concierge_review: { enabled: true },
    consultation_booking: { enabled: true },
  },
};

async function main() {
  await prisma.tenant.upsert({
    where: { id: GLOBAL_TENANT_ID },
    update: { slug: "global", name: "ExpertOS Global" },
    create: { id: GLOBAL_TENANT_ID, slug: "global", name: "ExpertOS Global" },
  });

  const featureByKey = new Map<string, string>();
  for (const f of FEATURES) {
    const row = await prisma.feature.upsert({
      where: { key: f.key },
      update: { name: f.name, type: f.type },
      create: { key: f.key, name: f.name, type: f.type },
    });
    featureByKey.set(f.key, row.id);
  }

  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { key: p.key },
      update: { name: p.name, sortOrder: p.sortOrder },
      create: { key: p.key, name: p.name, sortOrder: p.sortOrder },
    });

    for (const price of p.prices) {
      await prisma.planPrice.upsert({
        where: { planId_interval: { planId: plan.id, interval: price.interval } },
        update: { amountCents: price.amountCents },
        create: { planId: plan.id, interval: price.interval, amountCents: price.amountCents },
      });
    }

    for (const [featureKey, cell] of Object.entries(MATRIX[p.key])) {
      const featureId = featureByKey.get(featureKey);
      if (!featureId) throw new Error(`Unknown feature in matrix: ${featureKey}`);
      await prisma.planEntitlement.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        update: {
          enabled: cell.enabled,
          limit: cell.limit ?? null,
          softLimit: cell.softLimit ?? null,
          window: cell.window ?? null,
        },
        create: {
          planId: plan.id,
          featureId,
          enabled: cell.enabled,
          limit: cell.limit ?? null,
          softLimit: cell.softLimit ?? null,
          window: cell.window ?? null,
        },
      });
    }
  }

  await prisma.consultationType.upsert({
    where: { key: "intro_call" },
    update: { name: "Intro consultation", durationMinutes: 30 },
    create: { key: "intro_call", name: "Intro consultation", durationMinutes: 30 },
  });

  const [tenants, features, plans, entitlements] = await Promise.all([
    prisma.tenant.count(),
    prisma.feature.count(),
    prisma.plan.count(),
    prisma.planEntitlement.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: ${tenants} tenant(s), ${plans} plan(s), ${features} feature(s), ${entitlements} entitlement(s).`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
