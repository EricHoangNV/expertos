#!/usr/bin/env node
// @ts-check
/**
 * ExpertOS load smoke test (M11.3 — PRD §"Testing Strategy").
 *
 * A dependency-free Node load driver: it uses only the runtime's global `fetch` + `node:perf_hooks`,
 * so — like `infra/` — it needs no `node_modules` and is intentionally NOT a pnpm workspace (it stays
 * out of the turbo/jest/knip gates). It is **opt-in**: it drives a *live* stack, exactly like the
 * Playwright `e2e/` suite, so it can't run in CI/sandbox.
 *
 * What a smoke proves: the running API survives sustained concurrent traffic without erroring out or
 * blowing a latency budget — and, on the cache-warming `chat` scenario, that the M6.4 answer cache
 * actually engages under repeat load. It is a smoke, not a benchmark: small, fast, threshold-gated
 * (exit 1 on a breach), so it can gate a deploy.
 *
 * Run:  node load/smoke.mjs                 # health-only (no auth needed)
 *       LOAD_TOKEN=… node load/smoke.mjs    # also drive the authed chat + entitlements scenarios
 * See load/README.md for the full env surface and the live-stack prerequisites.
 */
import { performance } from "node:perf_hooks";

/** Reads a positive number from the environment, falling back to `fallback` when unset/invalid. */
function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const CONFIG = {
  baseUrl: (process.env.LOAD_BASE_URL ?? "http://localhost:3001").replace(/\/$/, ""),
  concurrency: Math.max(1, Math.round(numEnv("LOAD_CONCURRENCY", 20))),
  durationMs: Math.max(1000, Math.round(numEnv("LOAD_DURATION_SEC", 15) * 1000)),
  // Per-request hard timeout so one hung socket can't stall a whole phase.
  requestTimeoutMs: Math.max(1000, Math.round(numEnv("LOAD_REQUEST_TIMEOUT_SEC", 30) * 1000)),
  // Pass/fail gates — a smoke fails loudly rather than producing a report nobody reads.
  p95BudgetMs: numEnv("LOAD_P95_MS", 1500),
  maxErrorRate: numEnv("LOAD_MAX_ERROR_RATE", 0.01),
  token: process.env.LOAD_TOKEN, // Firebase ID token for the authed scenarios (member).
  adminToken: process.env.LOAD_ADMIN_TOKEN, // admin ID token to read cache stats after the run.
  only: process.env.LOAD_SCENARIO, // run just this named scenario when set.
  question: process.env.LOAD_QUESTION ?? "How do I file my taxes?",
  expertId: process.env.LOAD_EXPERT_ID, // optional voice; omitted = neutral voice.
};

/**
 * The scenario matrix. `auth: true` legs are skipped without `LOAD_TOKEN` (printed as such, never a
 * failure). The `chat` leg deliberately repeats one fixed question so the answer cache warms — the
 * first turn is cold (LLM), the rest should be served hot, which is exactly the M11.3 behavior under
 * test. `drain` reads the whole body so SSE streams are fully measured and sockets are not leaked.
 */
const SCENARIOS = [
  {
    name: "health",
    auth: false,
    request: () => ({ path: "/health", method: "GET" }),
  },
  {
    name: "entitlements",
    auth: true,
    request: () => ({ path: "/me/entitlements", method: "GET" }),
  },
  {
    name: "chat",
    auth: true,
    request: () => ({
      path: "/chat",
      method: "POST",
      body: {
        text: CONFIG.question,
        ...(CONFIG.expertId ? { expertId: CONFIG.expertId } : {}),
      },
    }),
  },
];

/** Issues one scenario request with a timeout, draining the body. Returns `{ ok, status }`. */
async function fire(scenario) {
  const spec = scenario.request();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const headers = {};
    if (scenario.auth && CONFIG.token) headers.authorization = `Bearer ${CONFIG.token}`;
    if (spec.body) headers["content-type"] = "application/json";
    const res = await fetch(CONFIG.baseUrl + spec.path, {
      method: spec.method,
      headers,
      body: spec.body ? JSON.stringify(spec.body) : undefined,
      signal: controller.signal,
    });
    // Drain the body fully (SSE streams included) before stopping the clock.
    await res.arrayBuffer();
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** The `p`-th percentile (0–100) of a latency sample, nearest-rank. */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

/** Runs one scenario at fixed concurrency for the configured duration; returns its summary. */
async function runPhase(scenario) {
  const latencies = [];
  let ok = 0;
  let failed = 0;
  const deadline = performance.now() + CONFIG.durationMs;

  async function worker() {
    while (performance.now() < deadline) {
      const start = performance.now();
      const { ok: success } = await fire(scenario);
      latencies.push(performance.now() - start);
      if (success) ok += 1;
      else failed += 1;
    }
  }

  await Promise.all(Array.from({ length: CONFIG.concurrency }, () => worker()));

  const total = ok + failed;
  const sorted = [...latencies].sort((a, b) => a - b);
  const errorRate = total === 0 ? 1 : failed / total;
  const p95 = percentile(sorted, 95);
  return {
    name: scenario.name,
    total,
    ok,
    failed,
    errorRate,
    rps: total / (CONFIG.durationMs / 1000),
    p50: percentile(sorted, 50),
    p95,
    p99: percentile(sorted, 99),
    // A phase passes only if it stayed under both gates.
    passed: errorRate <= CONFIG.maxErrorRate && p95 <= CONFIG.p95BudgetMs,
  };
}

/** Fetches the per-instance cache effectiveness (M11.3) so a warm run's hit rate is visible. */
async function fetchCacheStats() {
  if (!CONFIG.adminToken) return undefined;
  try {
    const res = await fetch(CONFIG.baseUrl + "/admin/analytics/cache", {
      headers: { authorization: `Bearer ${CONFIG.adminToken}` },
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const chosen = SCENARIOS.filter((s) => !CONFIG.only || s.name === CONFIG.only);
  if (chosen.length === 0) {
    console.error(`No scenario named "${CONFIG.only}" (known: ${SCENARIOS.map((s) => s.name).join(", ")})`);
    process.exit(2);
  }

  console.log(
    `ExpertOS load smoke → ${CONFIG.baseUrl}  ` +
      `(concurrency=${CONFIG.concurrency}, duration=${CONFIG.durationMs / 1000}s, ` +
      `p95≤${CONFIG.p95BudgetMs}ms, errors≤${pct(CONFIG.maxErrorRate)})\n`,
  );

  const results = [];
  for (const scenario of chosen) {
    if (scenario.auth && !CONFIG.token) {
      console.log(`• ${scenario.name.padEnd(13)} skipped (set LOAD_TOKEN to drive the authed path)`);
      continue;
    }
    const r = await runPhase(scenario);
    results.push(r);
    const verdict = r.passed ? "PASS" : "FAIL";
    console.log(
      `• ${r.name.padEnd(13)} ${verdict}  ` +
        `n=${r.total} rps=${r.rps.toFixed(1)} errors=${pct(r.errorRate)}  ` +
        `p50=${r.p50.toFixed(0)}ms p95=${r.p95.toFixed(0)}ms p99=${r.p99.toFixed(0)}ms`,
    );
  }

  const cache = await fetchCacheStats();
  if (cache) {
    console.log(
      `\ncache (this instance): retrieval=${pct(cache.retrieval.hitRate)} ` +
        `answer=${pct(cache.answerOverall.hitRate)} ` +
        `(memory=${pct(cache.answerMemory.hitRate)}, semantic=${pct(cache.semantic.hitRate)})`,
    );
  }

  const failedPhases = results.filter((r) => !r.passed);
  if (results.length === 0) {
    console.log("\nNothing ran (all scenarios skipped).");
    process.exit(0);
  }
  if (failedPhases.length > 0) {
    console.error(`\nFAIL — ${failedPhases.map((r) => r.name).join(", ")} breached a gate.`);
    process.exit(1);
  }
  console.log("\nPASS — all scenarios within budget.");
}

main().catch((err) => {
  console.error("load smoke crashed:", err);
  process.exit(2);
});
