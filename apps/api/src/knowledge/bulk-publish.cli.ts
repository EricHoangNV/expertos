/**
 * Bulk-publish EXPERT-REVIEWED knowledge versions (operator batch tool).
 *
 * This is the batch equivalent of an expert clicking "Approve & publish" in the portal. It publishes
 * documents whose latest version is already in `expert_review` — i.e. a human expert has reviewed them.
 * It routes every publish through the SAME shared primitive as `KnowledgeService.approve`
 * ({@link publishReviewedVersionTx}), so the retrieval-visibility side effects cannot drift, and that
 * primitive REFUSES to publish a `draft` version. There is intentionally NO path here that publishes
 * unreviewed drafts: that would ground user answers in knowledge no expert signed off on (the core
 * ExpertOS trust promise — see Security/Product review Cycle 4).
 *
 * For each publishable document it publishes the document's latest (`expert_review`) version:
 *   - version.status      → published, approvedBy = the --approver user, approvedAt = now
 *   - all its chunks      → status published   ← this is what makes the engine retrieve them
 *   - document            → publishedVersionId = thatVersion, status = published
 *   - any prior published version (+ its chunks) → archived (so retrieval never sees two)
 *   - an immutable admin audit row (`knowledge.bulk_published`) is written in the same transaction
 *
 * Commit guards (defence against an accidental mass publish):
 *   - env `KNOWLEDGE_BULK_PUBLISH=1` must be set (break-glass flag), AND
 *   - `--approver=<userId>` must name an existing admin/expert user (the source of authorization).
 *
 *   # dry run — reports what WOULD change, writes nothing (default):
 *   pnpm --filter @expertos/api bulk-publish
 *
 *   # actually publish (both guards required):
 *   KNOWLEDGE_BULK_PUBLISH=1 pnpm --filter @expertos/api bulk-publish -- --commit --approver=<userId>
 *
 *   # optional guards / filters:
 *   --expect=12             abort unless exactly N expert_review documents are found
 *   --ids=<uuid>,<uuid>     restrict to an explicit allowlist of document ids
 *   --scope=global_expert
 *   --language=vi
 *
 * Engine note: run with the DEFAULT (library) engine on a darwin host. Only the ralph Linux sandbox
 * needs `PRISMA_CLIENT_ENGINE_TYPE=binary` (the library engine SIGILLs there).
 */
import { GLOBAL_TENANT_ID, prisma, applyRlsContext } from "@expertos/db";
import type { Prisma } from "@expertos/db";
import { publishReviewedVersionTx } from "./publish-version";

interface Args {
  commit: boolean;
  approver: string | null;
  expect: number | null;
  ids: string[] | null;
  scope: string | null;
  language: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const idsRaw = get("ids");
  return {
    commit: argv.includes("--commit"),
    approver: get("approver") ?? null,
    expect: get("expect") ? Number(get("expect")) : null,
    ids: idsRaw ? idsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
    scope: get("scope") ?? null,
    language: get("language") ?? null,
  };
}

/** Run `work` inside a transaction scoped to the given RLS context. */
function withRls<T>(
  ctx: { tenantId: string; userId?: string; isAdmin: boolean },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyRlsContext(tx, ctx);
    return work(tx);
  });
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve + validate the approver up front (read-only). Required only for --commit, but if supplied
  // we validate it even on a dry run so the operator gets the error before the real run.
  let approver: { id: string; tenantId: string; isAdmin: boolean } | null = null;
  if (args.approver) {
    const row = await withRls({ tenantId: GLOBAL_TENANT_ID, isAdmin: true }, (tx) =>
      tx.user.findUnique({ where: { id: args.approver! }, select: { id: true, role: true, tenantId: true } }),
    );
    if (!row) {
      console.error(`✗ --approver=${args.approver} is not a known user.`);
      process.exitCode = 1;
      return;
    }
    if (row.role !== "admin" && row.role !== "expert") {
      console.error(`✗ --approver ${row.id} has role '${row.role}'; only an admin or expert may publish.`);
      process.exitCode = 1;
      return;
    }
    approver = { id: row.id, tenantId: row.tenantId, isAdmin: row.role === "admin" };
  }

  const where: Prisma.DocumentWhereInput = { status: "expert_review" };
  if (args.ids) where.id = { in: args.ids };
  if (args.scope) where.scope = args.scope as Prisma.DocumentWhereInput["scope"];
  if (args.language) where.language = args.language as Prisma.DocumentWhereInput["language"];

  // Snapshot the reviewed documents and their latest version up front (read-only, admin context).
  const docs = await withRls({ tenantId: GLOBAL_TENANT_ID, isAdmin: true }, (tx) =>
    tx.document.findMany({
      where,
      select: {
        id: true,
        title: true,
        tenantId: true,
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

  console.log(
    `Found ${docs.length} document(s) with status='expert_review'` +
      `${args.ids ? ` (restricted to ${args.ids.length} id(s))` : ""}` +
      `${args.scope ? ` scope=${args.scope}` : ""}${args.language ? ` language=${args.language}` : ""}.`,
  );

  if (args.expect !== null && docs.length !== args.expect) {
    console.error(`✗ Aborting: expected ${args.expect} document(s) but found ${docs.length}. Re-run without --expect or fix the filter.`);
    process.exitCode = 1;
    return;
  }

  // Only publish docs whose LATEST version is the expert_review one (defensive: a newer draft could
  // have been created after review). The shared primitive re-checks this and refuses anything else.
  const publishable = docs.filter((d) => d.versions[0]?.status === "expert_review");
  const skipped = docs.filter((d) => d.versions[0] && d.versions[0].status !== "expert_review");
  const noVersion = docs.filter((d) => !d.versions[0]);
  const versionIds = publishable.map((d) => d.versions[0]!.id);
  const zeroChunk = publishable.filter((d) => d.versions[0]!._count.chunks === 0);

  // Embedding coverage across the chunks we're about to publish (vector search needs embeddings).
  let totalChunks = 0;
  let embeddedChunks = 0;
  if (versionIds.length > 0) {
    const [row] = await withRls({ tenantId: GLOBAL_TENANT_ID, isAdmin: true }, (tx) =>
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
  console.log(`  publishable (latest version is expert_review) : ${publishable.length}`);
  console.log(`  skipped (latest version not expert_review)    : ${skipped.length}`);
  console.log(`  no version at all                             : ${noVersion.length}`);
  console.log(`  chunks to publish                             : ${totalChunks}`);
  console.log(`  …of which have embeddings (vector)            : ${embeddedChunks}${totalChunks ? ` (${Math.round((embeddedChunks / totalChunks) * 100)}%)` : ""}`);
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
    console.log("DRY RUN — nothing written. Re-run with `-- --commit --approver=<userId>` (and env KNOWLEDGE_BULK_PUBLISH=1) to publish.");
    return;
  }

  // --- Commit guards -------------------------------------------------------------------------------
  if (process.env.KNOWLEDGE_BULK_PUBLISH !== "1") {
    console.error("✗ Refusing to commit: set env KNOWLEDGE_BULK_PUBLISH=1 to confirm this break-glass bulk publish.");
    process.exitCode = 1;
    return;
  }
  if (!approver) {
    console.error("✗ Refusing to commit: --approver=<userId> is required (the admin/expert who authorizes this publish).");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(`Publishing ${publishable.length} document(s) as approver ${approver.id}…`);
  let ok = 0;
  let failed = 0;
  const affectedTenants = new Set<string>();
  for (const doc of publishable) {
    const version = doc.versions[0]!;
    try {
      await withRls({ tenantId: approver.tenantId, userId: approver.id, isAdmin: approver.isAdmin }, async (tx) => {
        await publishReviewedVersionTx(tx, {
          versionId: version.id,
          versionStatus: version.status,
          currentPublishedVersionId: doc.publishedVersionId,
          approverId: approver!.id,
        });
        await tx.adminAuditLog.create({
          data: {
            tenantId: approver!.tenantId,
            actorId: approver!.id,
            action: "knowledge.bulk_published",
            targetType: "document_version",
            targetId: version.id,
            metadata: { documentId: doc.id, versionNumber: version.versionNumber },
          },
        });
      });
      affectedTenants.add(doc.tenantId);
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok}/${publishable.length}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${doc.id} ${doc.title}:`, err instanceof Error ? err.message : err);
    }
  }

  // Drop the persistent (cross-process) semantic cache for every affected tenant so stale cached
  // answers don't outlive the publish. The in-process answer/retrieval LRU lives in the running API
  // process (unreachable from here) — it clears on its TTL or an API restart (see note below).
  for (const tenantId of affectedTenants) {
    const { count } = await withRls({ tenantId, isAdmin: true }, (tx) =>
      tx.semanticCacheEntry.deleteMany({ where: { tenantId } }),
    );
    console.log(`  cleared ${count} semantic-cache row(s) for tenant ${tenantId}.`);
  }

  console.log("");
  console.log(`Done: ${ok} published, ${failed} failed, ${skipped.length + noVersion.length} skipped.`);
  console.log("Note: the API's in-process answer/retrieval cache is not reachable from this CLI — new");
  console.log("answers reflect the published content after that cache's TTL expires (or an API restart).");
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
/* eslint-enable no-console */
