/**
 * Idempotent seed: the GLOBAL tenant, the launch plans + prices, the entitlement
 * catalog, and the plan×feature matrix (PRD §"Paywall, Entitlements & Feature Gating").
 *
 * Runs as the schema owner (bypasses RLS). The `ask_question` quota cells are now CALIBRATED
 * against the Open Decision #4 unit-economics model (M6.5) — see the MATRIX comment and the
 * worked margin analysis in PRD §"Open Decisions" #4. All cells remain admin-tunable without a
 * deploy (M8.3); this seed only sets the launch defaults. Re-running is safe (upsert by natural key).
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
//
// `ask_question` calibration (Open Decision #4 / M6.5; model in `observability/model-pricing.ts`):
//   modeled answer ≈ 3,000 prompt + 600 completion tokens →
//     standard model (Free/Plus)  ≈ $0.0008/answer   premium model (Premium) ≈ $0.018/answer
//     degraded "mini" model        ≈ $0.0008/answer   (≈20× cheaper than premium — the degrade win)
//   • Free 10/mo  → ≈ $0.008/mo model cost. Bounded for abuse; volume isn't the constraint here,
//     conversion is (the hook is "all expert voices", not answer count).
//   • Plus 200/mo hard cap @ $4.99 → ≈ $0.16/mo (~4% of net) on the standard tier. Comfortable
//     margin; a "moderate allowance" cap per the PRD pricing table (Plus does not degrade).
//   • Premium softLimit 500/mo @ $9.99 → premium-model spend capped at ≈ $9.00 (≈500 × $0.018),
//     then degrade to the mini model (≈ $0.0008/answer) for the rest. So the WORST-CASE premium
//     user is ≈ break-even, never deeply cost-negative — the degrade threshold is what protects
//     margin (a hard 500-cap premium-model user would otherwise approach the whole plan price).
//     Cache hits cost $0 but early-volume hit-rate is low, so margin is NOT assumed from caching.
type Cell = {
  enabled: boolean;
  limit?: number | null;
  softLimit?: number | null;
  window?: "day" | "week" | "month";
};
const MATRIX: Record<string, Record<string, Cell>> = {
  free: {
    ask_question: { enabled: true, limit: 10, window: "month" },
    document_upload: { enabled: false },
    all_expert_voices: { enabled: true },
    cited_answers: { enabled: true },
    saved_answers: { enabled: true, limit: 10, window: "month" },
    concierge_review: { enabled: false },
    consultation_booking: { enabled: true },
  },
  plus: {
    ask_question: { enabled: true, limit: 200, window: "month" },
    document_upload: { enabled: true },
    all_expert_voices: { enabled: true },
    cited_answers: { enabled: true },
    saved_answers: { enabled: true, limit: 100, window: "month" },
    concierge_review: { enabled: false },
    consultation_booking: { enabled: true },
  },
  premium: {
    ask_question: { enabled: true, limit: null, softLimit: 500, window: "month" },
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
