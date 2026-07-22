#!/usr/bin/env node
/**
 * Seed the benchmark KB enrichment into a fresh knowledge base.
 *
 * Ingests the committed enrichment content — hand-authored framework/method reference docs
 * (English + Vietnamese) and the distilled knowledge cards — as published global_expert
 * documents, so a fresh dev DB reproduces the enriched KB the benchmark was measured against.
 *
 * These docs are the honest, production-realistic enrichment (standard OpEx/Lean/Six-Sigma/
 * AI-governance methods + NCT's documented operating principles), NOT the benchmark answers.
 *
 * Usage:
 *   node scripts/benchmark/seed-kb-enrichment.cjs            # build manifest + print ingest cmd
 *   node scripts/benchmark/seed-kb-enrichment.cjs --ingest   # build manifest + ingest now
 *
 * Requires: Cloud SQL proxy on :5433, OPENAI_API_KEY, workspace built (apps/api/dist).
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const S = require("./lib/shared.cjs");

const ENRICH_DIR = path.join(S.BENCH_DIR, "kb-enrichment");
// Vietnamese diacritic range — used to tag each distilled card's language.
const VI_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function titleOf(file, fallback) {
  const first = fs.readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith("# "));
  return first ? first.replace(/^#\s*/, "").trim().slice(0, 200) : fallback;
}

function entriesFrom(subdir, { language, uriPrefix, titlePrefix = "" }) {
  const dir = path.join(ENRICH_DIR, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const file = path.join(dir, f);
    const lang = language || (VI_RE.test(fs.readFileSync(file, "utf8")) ? "vi" : "en");
    return {
      file,
      title: `${titlePrefix}${titleOf(file, f.replace(/\.md$/, ""))}`.slice(0, 200),
      contentType: "text/markdown",
      sourceUri: `kbm://${uriPrefix}/${f}`,
      scope: "global_expert",
      language: lang,
      changeSummary: "benchmark KB enrichment (committed)",
      publish: true,
    };
  });
}

function main() {
  const manifest = [
    ...entriesFrom("frameworks-en", { language: "en", uriPrefix: "enrichment" }),
    ...entriesFrom("frameworks-vi", { language: "vi", uriPrefix: "enrichment-vi" }),
    ...entriesFrom("positions-en", { language: "en", uriPrefix: "position" }),
    ...entriesFrom("positions-vi", { language: "vi", uriPrefix: "position-vi" }),
    ...entriesFrom("cards", { language: null, uriPrefix: "card", titlePrefix: "[Card] " }),
  ];
  const manifestPath = path.join(ENRICH_DIR, "manifest.generated.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Built manifest: ${manifest.length} entries -> ${manifestPath}`);
  console.log(`  frameworks-en: ${manifest.filter((m) => m.sourceUri.startsWith("kbm://enrichment/")).length}`);
  console.log(`  frameworks-vi: ${manifest.filter((m) => m.sourceUri.startsWith("kbm://enrichment-vi/")).length}`);
  console.log(`  positions-en:  ${manifest.filter((m) => m.sourceUri.startsWith("kbm://position/")).length}`);
  console.log(`  positions-vi:  ${manifest.filter((m) => m.sourceUri.startsWith("kbm://position-vi/")).length}`);
  console.log(`  cards:         ${manifest.filter((m) => m.sourceUri.startsWith("kbm://card/")).length}`);

  const ingestCli = path.join(S.ROOT, "apps", "api", "dist", "ingestion", "ingest.cli.js");
  if (process.argv.includes("--ingest")) {
    console.log("\nIngesting (publishes global_expert)...");
    S.loadEnv();
    execFileSync("node", [ingestCli, manifestPath], { stdio: "inherit", env: process.env });
  } else {
    console.log(`\nTo ingest:\n  node ${path.relative(S.ROOT, ingestCli)} "${manifestPath}"`);
  }
}

main();
