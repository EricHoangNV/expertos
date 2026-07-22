#!/usr/bin/env node
/**
 * Compare two scored benchmark runs — aggregate movement plus the biggest per-question
 * score swings. Use it to see whether a prompt/model/knowledge change helped or regressed.
 *
 * Usage:
 *   node scripts/benchmark/compare.cjs <baselineRunId> <candidateRunId> [--top 15]
 */
const path = require("node:path");
const S = require("./lib/shared.cjs");

function loadResults(runId) {
  const file = path.join(S.RESULTS_DIR, runId, "results.jsonl");
  const rows = S.readJsonl(file);
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.lang}:${r.id}`, r);
  let summary = null;
  try {
    summary = S.readJson(path.join(S.RESULTS_DIR, runId, "summary.json"));
  } catch {}
  return { byKey, summary };
}

function fmtDelta(n) {
  const s = n > 0 ? `+${n}` : `${n}`;
  return s.padStart(5);
}

function main() {
  const argv = process.argv.slice(2);
  const args = S.parseArgs(argv);
  // Positional run ids are the non-flag args (flags like --top consume their value,
  // but run ids never look like a flag value we parse, so filtering --* is enough here).
  const ids = argv.filter((a) => !a.startsWith("--"));
  const [baseId, candId] = ids;
  const top = args.top ? parseInt(args.top, 10) : 15;

  if (!baseId || !candId) {
    console.error("Usage: node scripts/benchmark/compare.cjs <baselineRunId> <candidateRunId> [--top N]");
    process.exitCode = 1;
    return;
  }

  const base = loadResults(baseId);
  const cand = loadResults(candId);

  if (base.summary && cand.summary) {
    const b = base.summary.overall;
    const c = cand.summary.overall;
    console.log(`\n=== Aggregate: ${baseId}  ->  ${candId} ===`);
    console.log(`  mean judge:      ${b.mean_judge}  ->  ${c.mean_judge}   (${fmtDelta(round(c.mean_judge - b.mean_judge))})`);
    console.log(`  mean similarity: ${b.mean_similarity}  ->  ${c.mean_similarity}   (${fmtDelta(round(c.mean_similarity - b.mean_similarity))})`);
    console.log(`  pass rate:       ${b.pass_rate}%  ->  ${c.pass_rate}%   (${fmtDelta(round(c.pass_rate - b.pass_rate))})`);
    for (const lang of ["en", "vi"]) {
      const bl = base.summary.byLanguage?.[lang];
      const cl = cand.summary.byLanguage?.[lang];
      if (bl && cl) console.log(`    ${lang}: judge ${bl.mean_judge} -> ${cl.mean_judge} (${fmtDelta(round(cl.mean_judge - bl.mean_judge))})`);
    }
  }

  // Per-question deltas over the intersection.
  const deltas = [];
  for (const [key, c] of cand.byKey) {
    const b = base.byKey.get(key);
    if (!b) continue;
    if (b.judge_score < 0 || c.judge_score < 0) continue;
    deltas.push({ key, id: c.id, lang: c.lang, base: b.judge_score, cand: c.judge_score, delta: c.judge_score - b.judge_score });
  }
  deltas.sort((a, b) => a.delta - b.delta);

  const regressions = deltas.filter((d) => d.delta < 0).slice(0, top);
  const improvements = deltas.filter((d) => d.delta > 0).slice(-top).reverse();

  console.log(`\n--- Biggest regressions (judge score down) ---`);
  if (!regressions.length) console.log("  none");
  for (const d of regressions) console.log(`  ${d.lang}#${String(d.id).padStart(3)}  ${String(d.base).padStart(3)} -> ${String(d.cand).padStart(3)}  (${fmtDelta(d.delta)})`);

  console.log(`\n--- Biggest improvements (judge score up) ---`);
  if (!improvements.length) console.log("  none");
  for (const d of improvements) console.log(`  ${d.lang}#${String(d.id).padStart(3)}  ${String(d.base).padStart(3)} -> ${String(d.cand).padStart(3)}  (${fmtDelta(d.delta)})`);

  const unchanged = deltas.length - deltas.filter((d) => d.delta !== 0).length;
  console.log(`\n${deltas.length} questions compared · ${unchanged} unchanged · mean delta ${round(deltas.reduce((a, d) => a + d.delta, 0) / (deltas.length || 1))}`);
}

function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

main();
