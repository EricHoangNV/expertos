#!/usr/bin/env node
/**
 * Benchmark scorer — reads a run's answers.jsonl and scores each generated answer
 * against its gold answer using two independent signals:
 *
 *   1. LLM judge (primary): a 0-100 rubric score for substance match (see lib/judge.cjs).
 *   2. Embedding cosine similarity (secondary): OpenAI embeddings of gold vs candidate,
 *      scaled to 0-100. Deterministic and near-free — a cheap regression tripwire that
 *      does not depend on judge stability.
 *
 * Usage:
 *   node scripts/benchmark/score.cjs --run-id <ID> [--judge-model gpt-4o] [--concurrency 4]
 *                                    [--pass 70]
 *
 * Output (in the same results/<runId>/ dir):
 *   results.jsonl   per-question: both scores + judge rationale/missing/contradictions
 *   summary.json    aggregates by language / difficulty / level, pass-rate, cost/latency
 */
const fs = require("node:fs");
const path = require("node:path");
const S = require("./lib/shared.cjs");
const { judgeAnswer } = require("./lib/judge.cjs");

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function groupStats(rows, keyFn, passThreshold) {
  const groups = {};
  for (const r of rows) {
    const key = keyFn(r) || "(none)";
    (groups[key] ||= []).push(r);
  }
  const out = {};
  for (const [key, rs] of Object.entries(groups)) {
    const judge = rs.map((r) => r.judge_score);
    const sim = rs.map((r) => r.similarity);
    out[key] = {
      count: rs.length,
      mean_judge: round(mean(judge)),
      mean_similarity: round(mean(sim)),
      pass_rate: round((rs.filter((r) => r.judge_score >= passThreshold).length / rs.length) * 100),
    };
  }
  return out;
}

async function main() {
  const args = S.parseArgs(process.argv.slice(2));
  const runId = args["run-id"];
  if (!runId) {
    console.error("ERROR: --run-id <ID> is required");
    process.exitCode = 1;
    return;
  }
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 4;
  const passThreshold = args.pass ? parseInt(args.pass, 10) : 70;
  const judgeModel = args["judge-model"] || process.env.BENCH_JUDGE_MODEL || undefined;

  const outDir = path.join(S.RESULTS_DIR, runId);
  const answersPath = path.join(outDir, "answers.jsonl");
  if (!fs.existsSync(answersPath)) {
    console.error(`ERROR: no answers at ${answersPath} — run run.cjs first`);
    process.exitCode = 1;
    return;
  }
  const answers = S.readJsonl(answersPath);

  // Providers: reuse the workspace's OpenAI judge + embedder. loadEnv + dist import
  // are done here (not via pipeline.cjs) so scoring needs no DB connection.
  S.loadEnv();
  const { ai, defaults } = S.requireDist();
  const { OpenAiLlmProvider, cosineSimilarity } = ai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY not set");
    process.exitCode = 1;
    return;
  }
  const judgeLlm = new OpenAiLlmProvider({ apiKey, model: judgeModel || "gpt-4o-mini" });
  const embedder = defaults.createDefaultEmbeddingProvider(process.env);

  console.log(`Scoring run ${runId}: ${answers.length} answer(s)`);
  console.log(`  judge: ${judgeLlm.name}  embedder: ${embedder.name}  pass>=${passThreshold}\n`);

  const resultsPath = path.join(outDir, "results.jsonl");
  fs.writeFileSync(resultsPath, ""); // fresh
  let scored = 0;
  let judgeTokens = 0;
  const t0 = Date.now();

  const results = await S.pool(answers, concurrency, async (a) => {
    // Embedding similarity (skip if answer empty → 0).
    let similarity = 0;
    try {
      if (a.answer && a.answer.trim()) {
        const [gv, cv] = await embedder.embed([a.gold_answer, a.answer]);
        similarity = round(Math.max(0, cosineSimilarity(gv, cv)) * 100);
      }
    } catch (e) {
      similarity = -1; // signal an embedding failure without aborting the run
    }

    let judge;
    try {
      judge = await judgeAnswer(
        judgeLlm,
        { question: a.question, gold: a.gold_answer, candidate: a.answer },
        { model: judgeModel },
      );
    } catch (e) {
      judge = { score: -1, verdict: "error", missing: [], contradictions: [], rationale: String(e.message || e), judgeModel: judgeLlm.name, judgeTokens: 0 };
    }
    judgeTokens += judge.judgeTokens || 0;

    const rec = {
      runId,
      id: a.id,
      lang: a.lang,
      category: a.category,
      level: a.level,
      difficulty: a.difficulty,
      judge_score: judge.score,
      similarity,
      verdict: judge.verdict,
      passed: judge.score >= passThreshold,
      missing: judge.missing,
      contradictions: judge.contradictions,
      rationale: judge.rationale,
      insufficient_knowledge: a.insufficient_knowledge ?? null,
      gen_error: a.error ?? null,
      judge_model: judge.judgeModel,
      question: a.question,
    };
    S.appendJsonl(resultsPath, rec);
    scored++;
    if (scored % 10 === 0 || scored === answers.length) process.stdout.write(`  ${scored}/${answers.length} scored\r`);
    return rec;
  });

  // Aggregate (exclude judge/embedding errors from means).
  const valid = results.filter((r) => r.judge_score >= 0);
  const overall = {
    count: valid.length,
    mean_judge: round(mean(valid.map((r) => r.judge_score))),
    mean_similarity: round(mean(valid.filter((r) => r.similarity >= 0).map((r) => r.similarity))),
    pass_rate: round((valid.filter((r) => r.passed).length / (valid.length || 1)) * 100),
    passed: valid.filter((r) => r.passed).length,
    insufficient_knowledge: results.filter((r) => r.insufficient_knowledge).length,
    judge_errors: results.filter((r) => r.judge_score < 0).length,
    gen_errors: results.filter((r) => r.gen_error).length,
  };

  const summary = {
    runId,
    scoredAt: new Date().toISOString(),
    gitSha: S.gitSha(),
    judgeModel: judgeLlm.name,
    embedder: embedder.name,
    passThreshold,
    overall,
    byLanguage: groupStats(valid, (r) => r.lang, passThreshold),
    byDifficulty: groupStats(valid, (r) => r.difficulty, passThreshold),
    byLevel: groupStats(valid, (r) => normalizeLevel(r.level), passThreshold),
    judgeTokens,
    scoreWallMs: Date.now() - t0,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  printSummary(summary);
  console.log(`\n  results: ${resultsPath}`);
  console.log(`  summary: ${path.join(outDir, "summary.json")}`);
}

// "Level 2 – Intermediate" / "Level 2 - Intermediate" / "Intermediate" → "Level 2"
function normalizeLevel(level) {
  if (!level) return "(none)";
  const m = String(level).match(/level\s*([0-9]+\+?)/i);
  return m ? `Level ${m[1]}` : String(level);
}

function printSummary(s) {
  const o = s.overall;
  console.log(`\n\n=== ${s.runId} ===`);
  console.log(`Overall: judge ${o.mean_judge}/100  ·  similarity ${o.mean_similarity}/100  ·  pass ${o.pass_rate}% (${o.passed}/${o.count})`);
  if (o.insufficient_knowledge) console.log(`  insufficient-knowledge: ${o.insufficient_knowledge}   gen-errors: ${o.gen_errors}   judge-errors: ${o.judge_errors}`);
  console.log(`\nBy language:`);
  for (const [k, v] of Object.entries(s.byLanguage)) console.log(`  ${k.padEnd(6)} judge ${String(v.mean_judge).padStart(5)}  sim ${String(v.mean_similarity).padStart(5)}  pass ${v.pass_rate}%  (n=${v.count})`);
  console.log(`\nBy level:`);
  for (const [k, v] of Object.entries(s.byLevel).sort()) console.log(`  ${k.padEnd(9)} judge ${String(v.mean_judge).padStart(5)}  pass ${v.pass_rate}%  (n=${v.count})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
