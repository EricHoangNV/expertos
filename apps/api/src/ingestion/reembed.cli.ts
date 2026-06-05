/**
 * Re-embed every chunk's vector with the CURRENTLY-CONFIGURED embedding provider (operator batch tool).
 *
 * Why this exists: switching the embedding model (`EMBEDDING_PROVIDER` unset/hashing → `openai`, M17.6)
 * makes every previously-stored `chunks.embedding` incompatible — cosine similarity across two
 * different embedding spaces is meaningless. After the env flip + restart, run this ONCE to rewrite
 * every chunk's vector with the new model so vector search is coherent again. During the brief window
 * between restart and completion, vector search is degraded but keyword search keeps serving answers
 * (hybrid retrieval, M1.2).
 *
 * It re-embeds each chunk's stored `content` — exactly the text {@link IngestionService} embeds — so a
 * re-embed and a fresh ingest land in the same vector space. The active provider is resolved from the
 * same {@link createDefaultEmbeddingProvider} gate the API uses, so what you set in env is what gets
 * written. Runs under a single admin RLS context which (USING app.is_admin()) spans every tenant, so
 * all chunks are covered regardless of status.
 *
 *   # dry run — reports counts + the active provider, writes nothing (default):
 *   pnpm --filter @expertos/api reembed
 *
 *   # actually rewrite every chunk's embedding (set the provider env you are cutting over to):
 *   EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @expertos/api reembed -- --commit
 *
 *   --batch=128   chunks per embedding request + per write transaction (default 256, clamped 1..256)
 *   --limit=100   stop after N chunks (smoke test)
 *
 * Engine note: run with the DEFAULT (library) engine on a darwin host. Only the ralph Linux sandbox
 * needs `PRISMA_CLIENT_ENGINE_TYPE=binary` (the library engine SIGILLs there).
 */
import { GLOBAL_TENANT_ID, prisma, applyRlsContext } from "@expertos/db";
import type { Prisma } from "@expertos/db";
import { toVectorLiteral } from "../database/vector";
import { createDefaultEmbeddingProvider } from "./ingestion.defaults";

const MAX_BATCH = 256;

interface Args {
  commit: boolean;
  batch: number;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const batchRaw = get("batch") ? Number(get("batch")) : MAX_BATCH;
  const batch = Number.isFinite(batchRaw) ? Math.min(MAX_BATCH, Math.max(1, Math.trunc(batchRaw))) : MAX_BATCH;
  const limitRaw = get("limit") ? Number(get("limit")) : null;
  return {
    commit: argv.includes("--commit"),
    batch,
    limit: limitRaw != null && Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : null,
  };
}

/** Run `work` inside a transaction scoped to the admin RLS context (spans all tenants). */
function withAdminRls<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
    return work(tx);
  });
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = createDefaultEmbeddingProvider();

  console.log(`Active embedding provider: ${provider.name} (${provider.dimensions} dims).`);
  if (provider.name === "hashing-dev") {
    console.log("⚠ This is the OFFLINE DEV embedder. Set EMBEDDING_PROVIDER=openai + OPENAI_API_KEY to re-embed with the real model.");
  }

  // Snapshot every chunk's id + content up front (read-only). Content is the exact text ingestion
  // embeds, so re-embedding it keeps a re-embed and a fresh ingest in the same vector space.
  const rows = await withAdminRls((tx) =>
    tx.chunk.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      ...(args.limit != null ? { take: args.limit } : {}),
    }),
  );

  console.log(`Found ${rows.length} chunk(s) to re-embed${args.limit != null ? ` (limited to ${args.limit})` : ""}.`);

  if (!args.commit) {
    console.log("");
    console.log("DRY RUN — nothing written. Re-run with `-- --commit` to rewrite every chunk's embedding.");
    return;
  }

  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let done = 0;
  let failed = 0;
  for (let start = 0; start < rows.length; start += args.batch) {
    const batch = rows.slice(start, start + args.batch);
    let vectors: number[][];
    try {
      vectors = await provider.embed(batch.map((c) => c.content));
    } catch (err) {
      failed += batch.length;
      console.error(`  ✗ embed failed for batch @${start}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (vectors.length !== batch.length) {
      failed += batch.length;
      console.error(`  ✗ provider returned ${vectors.length} vectors for ${batch.length} chunks @${start}; skipping batch.`);
      continue;
    }

    try {
      await withAdminRls(async (tx) => {
        for (let i = 0; i < batch.length; i++) {
          await tx.$executeRawUnsafe(
            "UPDATE chunks SET embedding = $1::vector WHERE id = $2::uuid",
            toVectorLiteral(vectors[i]),
            batch[i].id,
          );
        }
      });
      done += batch.length;
      console.log(`  …${done}/${rows.length}`);
    } catch (err) {
      failed += batch.length;
      console.error(`  ✗ write failed for batch @${start}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("");
  console.log(`Done: ${done} re-embedded, ${failed} failed.`);
  console.log("Note: the API's in-process retrieval cache is not reachable from this CLI — new vector");
  console.log("results take effect after that cache's TTL expires (or an API restart).");
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
/* eslint-enable no-console */
