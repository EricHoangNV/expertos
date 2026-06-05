/**
 * Bulk-publish knowledge drafts (one-off admin operation).
 *
 * Moves every `Document` currently in the Draft column straight to Published, mirroring the
 * per-version side effects of `KnowledgeService.approve()` (see knowledge.service.ts) but
 * RELAXING the precondition: `approve()` only accepts an `expert_review` version, whereas this
 * script publishes `draft` versions directly — i.e. it INTENTIONALLY SKIPS the AI-Processing
 * and Expert-Review gates. Use only when that bypass is what you actually want.
 *
 * For each draft document it publishes the document's latest version:
 *   - version.status      → published, approvedBy = SYSTEM, approvedAt = now
 *   - all its chunks      → status published   ← this is what makes the engine retrieve them
 *   - document            → publishedVersionId = thatVersion, status = published
 *   - any prior published version (+ its chunks) → archived (so retrieval never sees two)
 *
 * Retrieval note: keyword search matches any published chunk, but VECTOR search additionally
 * requires `embedding IS NOT NULL` (pgvector.store.ts). The dry run reports embedding coverage
 * so you know whether a draft will be fully retrievable or keyword-only.
 *
 *   # dry run — reports what WOULD change, writes nothing (default):
 *   pnpm --filter @expertos/api publish-drafts
 *
 *   # actually publish:
 *   pnpm --filter @expertos/api publish-drafts -- --commit
 *
 *   # optional guards / filters:
 *   --expect=349        abort unless exactly N draft documents are found
 *   --scope=global_expert
 *   --language=vi
 *
 * Engine note: run with the DEFAULT (library) engine on a darwin host. Only the ralph Linux
 * sandbox needs `PRISMA_CLIENT_ENGINE_TYPE=binary` (the library engine SIGILLs there); passing
 * that var on the host fails with "Invalid client engine type" since binary isn't generated here.
 */
import { GLOBAL_TENANT_ID, prisma, applyRlsContext } from "@expertos/db";
import type { Prisma } from "@expertos/db";
import type { AuthUser } from "../auth/auth.types";

const SYSTEM_USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: GLOBAL_TENANT_ID,
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: "System Bulk Publish",
  role: "admin", // admin → is_admin GUC → cross-tenant visibility/writes under RLS
  locale: "en",
};

interface Args {
  commit: boolean;
  expect: number | null;
  scope: string | null;
  language: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  return {
    commit: argv.includes("--commit"),
    expect: get("expect") ? Number(get("expect")) : null,
    scope: get("scope") ?? null,
    language: get("language") ?? null,
  };
}

/** Run `work` inside a transaction scoped to the SYSTEM admin's RLS context (mirrors RlsService). */
function withRls<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, {
      tenantId: SYSTEM_USER.tenantId,
      userId: SYSTEM_USER.id,
      isAdmin: true,
    });
    return work(tx);
  });
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const where: Prisma.DocumentWhereInput = { status: "draft" };
  if (args.scope) where.scope = args.scope as Prisma.DocumentWhereInput["scope"];
  if (args.language) where.language = args.language as Prisma.DocumentWhereInput["language"];

  // Snapshot the drafts and their latest version up front (read-only).
  const docs = await withRls((tx) =>
    tx.document.findMany({
      where,
      select: {
        id: true,
        title: true,
        publishedVersionId: true,
        versions: {
          select: { id: true, versionNumber: true, status: true, _count: { select: { chunks: true } } },
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  );

  console.log(`Found ${docs.length} document(s) with status='draft'${args.scope ? ` scope=${args.scope}` : ""}${args.language ? ` language=${args.language}` : ""}.`);

  if (args.expect !== null && docs.length !== args.expect) {
    console.error(`✗ Aborting: expected ${args.expect} draft document(s) but found ${docs.length}. Re-run without --expect or fix the filter.`);
    process.exitCode = 1;
    return;
  }

  // Classify: publishable (latest version is a draft) vs skip (latest is mid-flight elsewhere).
  const publishable = docs.filter((d) => d.versions[0]?.status === "draft");
  const skipped = docs.filter((d) => d.versions[0] && d.versions[0].status !== "draft");
  const noVersion = docs.filter((d) => !d.versions[0]);
  const versionIds = publishable.map((d) => d.versions[0]!.id);
  const zeroChunk = publishable.filter((d) => d.versions[0]!._count.chunks === 0);

  // Embedding coverage across the chunks we're about to publish (vector search needs embeddings).
  let totalChunks = 0;
  let embeddedChunks = 0;
  if (versionIds.length > 0) {
    const [row] = await withRls((tx) =>
      tx.$queryRaw<{ total: bigint; embedded: bigint }[]>`
        SELECT count(*)::bigint AS total,
               count(embedding)::bigint AS embedded
        FROM chunks
        WHERE document_version_id = ANY(${versionIds}::uuid[])`,
    );
    totalChunks = Number(row?.total ?? 0);
    embeddedChunks = Number(row?.embedded ?? 0);
  }

  console.log("");
  console.log(`  publishable (latest version is draft) : ${publishable.length}`);
  console.log(`  skipped (latest version not draft)    : ${skipped.length}`);
  console.log(`  no version at all                     : ${noVersion.length}`);
  console.log(`  chunks to publish                     : ${totalChunks}`);
  console.log(`  …of which have embeddings (vector)    : ${embeddedChunks}${totalChunks ? ` (${Math.round((embeddedChunks / totalChunks) * 100)}%)` : ""}`);
  if (totalChunks > embeddedChunks) {
    console.log(`  ⚠ ${totalChunks - embeddedChunks} chunk(s) lack embeddings — those are keyword-retrievable only, not vector.`);
  }
  if (zeroChunk.length > 0) {
    console.log(`  ⚠ ${zeroChunk.length} document(s) have ZERO chunks — publishing them gives the engine nothing to retrieve:`);
    for (const d of zeroChunk.slice(0, 10)) console.log(`      - ${d.id}  ${d.title}`);
    if (zeroChunk.length > 10) console.log(`      …and ${zeroChunk.length - 10} more`);
  }
  if (skipped.length > 0) {
    console.log(`  ⚠ skipping (latest version is ${skipped.map((d) => d.versions[0]!.status).join("/")}); these need the normal review flow:`);
    for (const d of skipped.slice(0, 10)) console.log(`      - ${d.id}  ${d.title}  (latest=${d.versions[0]!.status})`);
  }

  if (!args.commit) {
    console.log("");
    console.log("DRY RUN — nothing written. Re-run with `-- --commit` to publish.");
    return;
  }

  console.log("");
  console.log(`Publishing ${publishable.length} document(s)…`);
  let ok = 0;
  let failed = 0;
  for (const doc of publishable) {
    const version = doc.versions[0]!;
    try {
      await withRls(async (tx) => {
        const now = new Date();
        // Supersede a previously-published version (defensive — draft docs normally have none).
        if (doc.publishedVersionId && doc.publishedVersionId !== version.id) {
          await tx.documentVersion.update({ where: { id: doc.publishedVersionId }, data: { status: "archived" } });
          await tx.chunk.updateMany({ where: { documentVersionId: doc.publishedVersionId }, data: { status: "archived" } });
        }
        await tx.documentVersion.update({
          where: { id: version.id },
          data: { status: "published", approvedBy: SYSTEM_USER.id, approvedAt: now },
        });
        await tx.chunk.updateMany({ where: { documentVersionId: version.id }, data: { status: "published" } });
        await tx.document.update({
          where: { id: doc.id },
          data: { publishedVersionId: version.id, status: "published" },
        });
      });
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok}/${publishable.length}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${doc.id} ${doc.title}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("");
  console.log(`Done: ${ok} published, ${failed} failed, ${skipped.length + noVersion.length} skipped.`);
  console.log("Note: the live response cache is not invalidated by this script — new answers reflect");
  console.log("the published content after the cache TTL expires (or restart the API to clear it now).");
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
/* eslint-enable no-console */
