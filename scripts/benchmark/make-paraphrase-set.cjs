#!/usr/bin/env node
/**
 * Build the paraphrase held-out set: a robustness probe for enrichment overfit.
 *
 * The signature-position docs are question-shaped, so the sharpest overfit risk is that
 * they only work when the benchmark question is phrased the way the doc is phrased. This
 * tool takes a fixed subset of the 100 UAT questions (all 15 position-target archetypes +
 * 10 non-targets as a control) and rewrites each question with substantially different
 * wording while preserving meaning and language. Gold answers and metadata are unchanged.
 *
 * If scores hold on the paraphrased set, retrieval generalizes past exact phrasing; if the
 * position-target questions crater while controls hold, the position docs are overfit.
 *
 * This is NOT a true held-out set (the topics were still seen when authoring enrichment) —
 * see data/HELDOUT-README.md for what to request from the expert for that.
 *
 * Usage:
 *   node scripts/benchmark/make-paraphrase-set.cjs [--model gpt-4o]
 *
 * Output: data/heldout-paraphrase.{en,vi}.json  (25 records each)
 * Run it:  node scripts/benchmark/run.cjs --set heldout-paraphrase --run-id <ID>
 */
const fs = require("node:fs");
const path = require("node:path");
const S = require("./lib/shared.cjs");

// 15 position-target archetypes (the stuck "challenge-the-premise" questions) + 10 controls.
const TARGET_IDS = [3, 4, 9, 12, 15, 16, 19, 20, 27, 29, 31, 36, 40, 47, 53];
const CONTROL_IDS = [1, 24, 42, 55, 62, 70, 78, 85, 91, 99];

const SYSTEM = `You rewrite questions for a retrieval-robustness test. Rewrite the given question so that:
- The meaning, intent, and difficulty are IDENTICAL — a perfect answer to one is a perfect answer to the other.
- The wording and sentence structure are SUBSTANTIALLY different (different opening, different phrasing; reorder clauses; use synonyms).
- The language stays the same (Vietnamese stays Vietnamese, English stays English).
- Domain terms that have no natural synonym (KPI, Lean, Six Sigma, AI, CEO, OKR) may be kept.
Output ONLY the rewritten question, no quotes, no preamble.`;

async function main() {
  const args = S.parseArgs(process.argv.slice(2));
  const model = args.model || "gpt-4o";
  S.loadEnv();
  const { ai } = S.requireDist();
  const llm = new ai.OpenAiLlmProvider({ apiKey: process.env.OPENAI_API_KEY, model });

  const ids = new Set([...TARGET_IDS, ...CONTROL_IDS]);
  for (const lang of ["en", "vi"]) {
    const rows = S.loadDataset(lang).filter((r) => ids.has(r.id));
    const out = [];
    for (const r of rows) {
      const { text } = await llm.complete(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: r.question },
        ],
        { temperature: 0.7 },
      );
      const paraphrased = text.trim().replace(/^["'“”]+|["'“”]+$/g, "");
      out.push({
        ...r,
        question: paraphrased,
        original_question: r.question,
        heldout_group: TARGET_IDS.includes(r.id) ? "position-target" : "control",
      });
      process.stdout.write(`  ${lang} Q${r.id} done\r`);
    }
    const file = path.join(S.DATA_DIR, `heldout-paraphrase.${lang}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
    console.log(`${lang}: ${out.length} paraphrased -> ${file}`);
  }
  console.log("\nSample (en Q20):");
  const en = JSON.parse(fs.readFileSync(path.join(S.DATA_DIR, "heldout-paraphrase.en.json"), "utf8"));
  const q20 = en.find((r) => r.id === 20);
  if (q20) {
    console.log("  original:    " + q20.original_question);
    console.log("  paraphrased: " + q20.question);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
