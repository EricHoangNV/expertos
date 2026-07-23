#!/usr/bin/env node
/**
 * Benchmark runner — sends every question in the EN and/or VI dataset through the
 * ExpertOS answer pipeline and records the generated answers. Scoring is a separate
 * step (score.cjs) so an expensive generation run can be re-scored without re-running.
 *
 * Usage:
 *   node scripts/benchmark/run.cjs [--lang en|vi|both] [--limit N] [--only 1,2,3]
 *                                  [--concurrency 4] [--topk 8] [--run-id ID] [--resume]
 *
 * Output: scripts/benchmark/results/<runId>/
 *   run-meta.json   run configuration + provenance (git sha, model, dataset hash)
 *   answers.jsonl   one line per question (see record shape below)
 *
 * Answer record:
 *   { runId, id, lang, category, level, difficulty, question, gold_answer,
 *     answer, model, high_stakes, topK, retrieved[], citations_count,
 *     insufficient_knowledge, prompt_tokens, completion_tokens, latency_ms,
 *     error, generated_at }
 */
const fs = require("node:fs");
const path = require("node:path");
const S = require("./lib/shared.cjs");
const { createHarness } = require("./lib/pipeline.cjs");

async function main() {
  const args = S.parseArgs(process.argv.slice(2));
  const langArg = (args.lang || "both").toLowerCase();
  const langs = langArg === "both" ? ["en", "vi"] : [langArg];
  const limit = args.limit ? parseInt(args.limit, 10) : null;
  const only = args.only ? new Set(String(args.only).split(",").map((s) => parseInt(s.trim(), 10))) : null;
  // Default concurrency is conservative: the dev DB is a tiny f1-micro (max_connections=25).
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
  const maxAttempts = args.retries ? parseInt(args.retries, 10) + 1 : 3;
  const topK = args.topk ? parseInt(args.topk, 10) : 8;
  const runId = args["run-id"] || S.newRunId();
  const resume = Boolean(args.resume);
  // Voice: default to the NCT expert; --expert none (or --neutral) renders neutral voice.
  const expertSlug = args.neutral || args.expert === "none" ? null : args.expert || "nct";
  // Question set: file prefix under data/ (default the frozen 100-Q UAT set).
  // e.g. --set heldout-paraphrase loads data/heldout-paraphrase.{en,vi}.json.
  const set = args.set || "dataset";

  const outDir = path.join(S.RESULTS_DIR, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const answersPath = path.join(outDir, "answers.jsonl");

  // Build the work list from the frozen datasets.
  let work = [];
  const datasetHashes = {};
  for (const lang of langs) {
    const rows = S.loadDataset(lang, set);
    datasetHashes[lang] = S.sha256(JSON.stringify(rows));
    let subset = rows;
    if (only) subset = subset.filter((r) => only.has(r.id));
    if (limit) subset = subset.slice(0, limit);
    work.push(...subset.map((r) => ({ ...r, topK })));
  }

  // Resume support: skip (id,lang) pairs already present in answers.jsonl.
  const done = new Set();
  if (resume) {
    for (const rec of S.readJsonl(answersPath)) done.add(`${rec.lang}:${rec.id}`);
    work = work.filter((w) => !done.has(`${w.lang}:${w.id}`));
  }

  const meta = {
    runId,
    startedAt: new Date().toISOString(),
    set,
    langs,
    counts: langs.reduce((acc, l) => ({ ...acc, [l]: work.filter((w) => w.lang === l).length }), {}),
    total: work.length,
    concurrency,
    topK,
    expertSlug,
    gitSha: S.gitSha(),
    datasetHashes,
    resume,
  };
  fs.writeFileSync(path.join(outDir, "run-meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Run ${runId}`);
  console.log(`  ${work.length} question(s) [${langs.join(", ")}]  concurrency=${concurrency}  topK=${topK}`);
  if (work.length === 0) {
    console.log("  nothing to do.");
    return;
  }

  const harness = createHarness({ expertSlug });
  const voice = await harness.voiceStatus();
  console.log(`  model: ${harness.llm.name}  embedder: ${harness.embedder.name}`);
  if (voice.expertName) {
    console.log(`  voice: ${voice.expertName} (${expertSlug})  profiles: en=${voice.profiles.en ? "yes" : "NO->neutral"} vi=${voice.profiles.vi ? "yes" : "NO->neutral"}\n`);
  } else {
    console.log(`  voice: neutral${expertSlug ? ` (expert "${expertSlug}" not found)` : ""}\n`);
  }
  meta.voice = voice;
  fs.writeFileSync(path.join(outDir, "run-meta.json"), JSON.stringify(meta, null, 2));

  let completed = 0;
  let failed = 0;
  const t0 = Date.now();

  await S.pool(work, concurrency, async (row) => {
    const started = Date.now();
    const base = {
      runId,
      id: row.id,
      lang: row.lang,
      category: row.category,
      level: row.level,
      difficulty: row.difficulty,
      question: row.question,
      gold_answer: row.gold_answer,
    };
    try {
      let g;
      let lastErr;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          g = await harness.generate(row.question, { language: row.lang, topK: row.topK });
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (!g) throw lastErr;
      const rec = {
        ...base,
        answer: g.answer,
        model: g.model,
        voiced: g.voiced,
        expert_name: g.expertName,
        voice_examples: g.voiceExampleCount,
        high_stakes: g.highStakes,
        topK: g.topK,
        retrieved: g.retrieved,
        citations_count: g.citationsCount,
        insufficient_knowledge: g.insufficientKnowledge,
        prompt_tokens: g.promptTokens,
        completion_tokens: g.completionTokens,
        latency_ms: Date.now() - started,
        error: null,
        generated_at: new Date().toISOString(),
      };
      S.appendJsonl(answersPath, rec);
      completed++;
    } catch (err) {
      S.appendJsonl(answersPath, {
        ...base,
        answer: "",
        error: String(err && err.message ? err.message : err),
        latency_ms: Date.now() - started,
        generated_at: new Date().toISOString(),
      });
      failed++;
    }
    const n = completed + failed;
    if (n % 10 === 0 || n === work.length) {
      process.stdout.write(`  ${n}/${work.length} done (${failed} failed)\r`);
    }
  });

  await harness.close();

  const meta2 = { ...meta, finishedAt: new Date().toISOString(), completed, failed, wallMs: Date.now() - t0 };
  fs.writeFileSync(path.join(outDir, "run-meta.json"), JSON.stringify(meta2, null, 2));

  console.log(`\n\nDone: ${completed} ok, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  answers: ${answersPath}`);
  console.log(`  next:    node scripts/benchmark/score.cjs --run-id ${runId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
