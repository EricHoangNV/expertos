#!/usr/bin/env node
/**
 * Distill knowledge documents into dense "knowledge cards" for retrieval.
 *
 * The KB is largely conversational transcripts and long-form docs: high-value content diluted
 * by greetings, anecdotes, and repetition, so retrieved chunks are often loose talk rather than
 * crisp facts. This tool reads each target document, uses an LLM to distill it into a compact
 * card (core claims, named frameworks + definitions, key numbers, the expert's stance), and
 * writes a manifest of cards to ingest as additional published chunks. Retrieval then has a
 * high-signal representation of each source alongside the verbose original.
 *
 * Usage:
 *   node scripts/benchmark/distill-cards.cjs <docIdsJsonFile> [--concurrency 4] [--model gpt-4o-mini]
 *     docIdsJsonFile: JSON array of documentVersionIds to distill.
 *
 * Output:
 *   tmp/kb-cards/*.md              one card per document
 *   tmp/kb-cards/manifest.cards.json   ingest manifest (scope global_expert, publish true)
 */
const fs = require("node:fs");
const path = require("node:path");
const S = require("./lib/shared.cjs");

const GLOBAL_TENANT = "00000000-0000-0000-0000-000000000000";
const SYSTEM_USER = "11111111-1111-1111-1111-111111111111";
const OUT_DIR = path.join(S.ROOT, "tmp", "kb-cards");

const DISTILL_SYSTEM = `You distill an expert's knowledge document into a dense, factual KNOWLEDGE CARD for retrieval in a Q&A system.

Extract and keep:
- The core claims, positions, and recommendations (especially any contrarian or counterintuitive stance).
- Every named framework, model, or method, WITH its definition, components, or steps.
- Key numbers, thresholds, and specific criteria.
- The expert's distinctive point of view.

Drop: greetings, host/intro/outro chatter, anecdotes that carry no transferable lesson, repetition, and filler.

Output compact markdown: a short "# " title, then tight bullet points. Preserve the ORIGINAL LANGUAGE of the source (Vietnamese stays Vietnamese, English stays English). Do not add facts that are not in the source. No preamble, output only the card.`;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "card";
}

async function main() {
  const docIdsFile = process.argv[2];
  if (!docIdsFile || process.argv[2].startsWith("--")) {
    console.error("usage: distill-cards.cjs <docIdsJsonFile> [--concurrency N] [--model M]");
    process.exitCode = 1;
    return;
  }
  const args = S.parseArgs(process.argv.slice(3));
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 4;
  const model = args.model || "gpt-4o-mini";
  const docIds = JSON.parse(fs.readFileSync(docIdsFile, "utf8"));

  S.loadEnv();
  const { db, ai, defaults } = S.requireDist();
  const { PrismaClient, applyRlsContext } = db;
  const { OpenAiLlmProvider } = ai;
  const llm = new OpenAiLlmProvider({ apiKey: process.env.OPENAI_API_KEY, model });
  const prisma = new PrismaClient({ transactionOptions: { timeout: 60000, maxWait: 20000 } });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Distilling ${docIds.length} documents with ${model} (concurrency ${concurrency})...`);

  // Pull each doc's title + ordered content in one RLS-scoped read.
  const docs = await prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, { tenantId: GLOBAL_TENANT, userId: SYSTEM_USER, isAdmin: true });
    return tx.$queryRawUnsafe(
      `SELECT dv.id AS version_id, d.title, d.source_uri,
              (array_agg(c.language ORDER BY c.chunk_index))[1] AS language,
              string_agg(c.content, E'\n\n' ORDER BY c.chunk_index) AS content
         FROM document_versions dv
         JOIN documents d ON d.id = dv.document_id
         JOIN chunks c ON c.document_version_id = dv.id
        WHERE dv.id = ANY($1::uuid[]) AND c.status = 'published'
        GROUP BY dv.id, d.title, d.source_uri`,
      docIds,
    );
  });
  console.log(`Loaded ${docs.length} documents from the KB.`);

  const manifest = [];
  let done = 0, failed = 0, skipped = 0;
  await S.pool(docs, concurrency, async (doc) => {
    const content = (doc.content || "").trim();
    // Skip docs that are already short/crisp — distillation adds nothing.
    if (content.length < 600) { skipped++; return; }
    try {
      const { text } = await llm.complete(
        [
          { role: "system", content: DISTILL_SYSTEM },
          { role: "user", content: `SOURCE TITLE: ${doc.title}\n\nSOURCE DOCUMENT:\n${content.slice(0, 24000)}` },
        ],
        { temperature: 0 },
      );
      const card = text.trim();
      if (card.length < 40) { skipped++; return; }
      const fname = `${slugify(doc.title)}-${doc.version_id.slice(0, 8)}.md`;
      fs.writeFileSync(path.join(OUT_DIR, fname), card + "\n");
      manifest.push({
        file: path.join(OUT_DIR, fname),
        title: `[Card] ${doc.title}`.slice(0, 200),
        contentType: "text/markdown",
        sourceUri: `kbm://card/${doc.version_id}`,
        scope: "global_expert",
        language: doc.language === "vi" ? "vi" : "en",
        changeSummary: `distilled knowledge card from ${doc.source_uri || doc.version_id}`,
        publish: true,
      });
      done++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`  distill failed for ${doc.title}: ${e.message}`);
    }
    if ((done + failed + skipped) % 20 === 0) process.stdout.write(`  ${done + failed + skipped}/${docs.length}\r`);
  });

  fs.writeFileSync(path.join(OUT_DIR, "manifest.cards.json"), JSON.stringify(manifest, null, 2));
  await prisma.$disconnect();
  console.log(`\nDone: ${done} cards, ${skipped} skipped (too short), ${failed} failed.`);
  console.log(`Manifest: ${path.join(OUT_DIR, "manifest.cards.json")} (${manifest.length} entries)`);
  console.log(`Ingest:   node apps/api/dist/ingestion/ingest.cli.js "${path.join(OUT_DIR, "manifest.cards.json")}"`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
