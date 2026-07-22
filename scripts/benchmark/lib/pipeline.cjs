/**
 * Reconstructs the production answer pipeline (ChatService.answerStream) in-process,
 * with no HTTP server and no Firebase auth — the path tmp/verify_llm.cjs proved:
 *
 *   embed(query) -> PgVectorStore.retrieve (published / global_expert)
 *     -> [load expert voice: profile + top-3 examples]
 *     -> buildAnswerPrompt({ query, facts, language, highStakes, voice, voiceExamples })
 *     -> llm.completeStream() -> buildCitations()
 *
 * Voice: when an expert slug is configured (default "nct"), answers render in that
 * expert's voice, mirroring ChatService: load the published voice profile for the answer
 * language, retrieve the top-3 nearest voice examples by cosine, and pass both into the
 * prompt builder. If no published profile exists for a language, that language falls back
 * to neutral voice (exactly as production does). Pass expertSlug=null to force neutral.
 */
const path = require("node:path");
const { loadEnv, requireDist, ROOT } = require("./shared.cjs");

// Global-tenant RLS context — the admin scope the API resolves published,
// global-expert knowledge (and voice) under (mirrors tmp/verify_llm_voice.cjs).
const GLOBAL_TENANT = "00000000-0000-0000-0000-000000000000";
const SYSTEM_USER = "11111111-1111-1111-1111-111111111111";
const VOICE_EXAMPLE_TOPK = 3; // matches ChatService.VOICE_EXAMPLE_TOPK

function createHarness({ expertSlug = "nct" } = {}) {
  loadEnv();
  const { db, ai, PgVectorStore, defaults } = requireDist();
  const { PrismaClient, applyRlsContext } = db;
  const { buildAnswerPrompt, buildCitations, detectHighStakes } = ai;
  const { toVectorLiteral } = require(path.join(ROOT, "apps", "api", "dist", "database", "vector"));

  // The dev DB is a tiny Cloud SQL f1-micro (max_connections=25) on an external SSD behind
  // the Cloud SQL proxy. Cap the Prisma pool so we never exhaust those slots, and give
  // interactive transactions generous room (the seed script uses 60s for the same reason).
  if (process.env.DATABASE_URL && !/[?&]connection_limit=/.test(process.env.DATABASE_URL)) {
    const sep = process.env.DATABASE_URL.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = `${process.env.DATABASE_URL}${sep}connection_limit=8&pool_timeout=60`;
  }
  const prisma = new PrismaClient({ transactionOptions: { timeout: 60000, maxWait: 20000 } });
  const embedder = defaults.createDefaultEmbeddingProvider(process.env);
  const llm = defaults.createDefaultLlmProvider(process.env);

  // Load the expert + published profiles once; cache the promise so concurrent
  // generate() calls share a single lookup.
  let voicePromise = null;
  function ensureVoice() {
    if (voicePromise) return voicePromise;
    if (!expertSlug) {
      voicePromise = Promise.resolve({ expert: null, profiles: {} });
      return voicePromise;
    }
    voicePromise = prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT, userId: SYSTEM_USER, isAdmin: true });
      const expert = await tx.expert.findFirst({ where: { tenantId: GLOBAL_TENANT, slug: expertSlug } });
      const profiles = {};
      if (expert) {
        for (const lang of ["en", "vi"]) {
          profiles[lang] = await tx.voiceProfile.findFirst({
            where: { tenantId: GLOBAL_TENANT, expertId: expert.id, language: lang, status: "published" },
          });
        }
      }
      return { expert, profiles };
    });
    return voicePromise;
  }

  async function generate(query, { language = "en", topK = 8 } = {}) {
    const highStakes = detectHighStakes(query) !== null;
    const voice = await ensureVoice();
    const profile = voice.expert ? voice.profiles[language] : null;

    // Embed OUTSIDE the transaction. An OpenAI round-trip inside an interactive
    // transaction blows the timeout under concurrency ("Transaction already closed"),
    // so the transaction below stays pure, fast DB work (retrieve + voice examples).
    const [embedding] = await embedder.embed([query]);

    const { messages, citations, retrieved, voiceExampleCount } = await prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT, userId: SYSTEM_USER, isAdmin: true });
      const store = new PgVectorStore(tx);
      const chunks = await store.retrieve({
        text: query,
        embedding,
        topK,
        filters: { status: "published", scope: ["global_expert"] },
      });
      const facts = chunks.map((c) => ({
        chunkId: c.chunkId,
        documentVersionId: c.documentVersionId,
        content: c.content,
      }));

      let voiceExamples = [];
      if (profile) {
        const rows = await tx.$queryRawUnsafe(
          `SELECT prompt, content FROM voice_examples
             WHERE voice_profile_id = $2::uuid AND embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector ASC LIMIT ${VOICE_EXAMPLE_TOPK}`,
          toVectorLiteral(embedding),
          profile.id,
        );
        voiceExamples = rows.map((e) => ({ prompt: e.prompt, content: e.content }));
      }

      const prompt = buildAnswerPrompt({
        query,
        facts,
        language,
        highStakes,
        voice: profile ? { expertName: voice.expert.displayName, guidelines: profile.guidelines } : undefined,
        voiceExamples: profile ? voiceExamples : undefined,
      });
      return {
        messages: prompt.messages,
        citations: prompt.citations,
        voiceExampleCount: voiceExamples.length,
        retrieved: chunks.map((c) => ({
          documentVersionId: c.documentVersionId,
          chunkId: c.chunkId,
          score: Number(c.score?.toFixed?.(4) ?? c.score ?? 0),
        })),
      };
    });

    const { text, usage } = await llm.complete(messages);
    const built = buildCitations({ answer: text, citations });

    return {
      answer: text,
      model: llm.name,
      highStakes,
      topK,
      retrieved,
      citationsCount: built.citations.length,
      insufficientKnowledge: retrieved.length === 0,
      voiced: Boolean(profile),
      expertName: profile ? voice.expert.displayName : null,
      voiceExampleCount,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
    };
  }

  async function voiceStatus() {
    const v = await ensureVoice();
    return {
      expertSlug,
      expertName: v.expert?.displayName ?? null,
      profiles: { en: Boolean(v.profiles.en), vi: Boolean(v.profiles.vi) },
    };
  }

  async function close() {
    await prisma.$disconnect();
  }

  return { generate, voiceStatus, embedder, llm, close };
}

module.exports = { createHarness, GLOBAL_TENANT, SYSTEM_USER };
