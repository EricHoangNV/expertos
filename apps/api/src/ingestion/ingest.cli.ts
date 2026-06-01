/**
 * Seed/CLI knowledge loader (M1.1). Runs the ingestion pipeline over a JSON manifest of
 * local files — the initial way expert knowledge enters the system, before the admin
 * upload UI (M8) and query-time uploads (M5).
 *
 *   pnpm --filter @expertos/api ingest path/to/manifest.json
 *
 * Manifest: an array of entries. `file` is read from disk; `sourceUri` defaults to the
 * file path. Documents are ingested into the GLOBAL tenant under a system admin context
 * and published immediately so retrieval (M1.2) can see them.
 *
 *   [{ "file": "./kb/tax.md", "title": "Tax Basics", "contentType": "text/markdown" }]
 *
 * Local-engine note: prefix with `PRISMA_CLIENT_ENGINE_TYPE=binary` on this sandbox
 * (the default library engine SIGILLs here — see LEARNINGS #1).
 */
import { readFileSync } from "node:fs";
import { GLOBAL_TENANT_ID, prisma } from "@expertos/db";
import type { AuthUser } from "../auth/auth.types";
import { RlsService } from "../auth/rls.service";
import { StructuredLogger } from "../observability/logger.service";
import { UsageLogService } from "../observability/usage-log.service";
import { IngestionService, EmptyDocumentError } from "./ingestion.service";
import { DocumentVersionRepository } from "./document-version.repository";
import { UnsupportedContentTypeError } from "./parser-registry";
import {
  createDefaultEmbeddingProvider,
  createDefaultParserRegistry,
  createDefaultSummarizer,
} from "./ingestion.defaults";

interface ManifestEntry {
  file: string;
  title: string;
  contentType: string;
  sourceUri?: string;
  scope?: string;
  language?: string;
  changeSummary?: string;
  publish?: boolean;
}

const SYSTEM_USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: GLOBAL_TENANT_ID,
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: "System Ingestion",
  role: "admin",
  locale: "en",
};

/* eslint-disable no-console */
async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("usage: ingest <manifest.json>");
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];

  const logger = new StructuredLogger();
  const rls = new RlsService(prisma);
  const service = new IngestionService(
    createDefaultParserRegistry(),
    createDefaultEmbeddingProvider(),
    createDefaultSummarizer(),
    new DocumentVersionRepository(rls),
    new UsageLogService(rls, logger),
    logger,
  );

  let ok = 0;
  for (const entry of manifest) {
    try {
      const result = await service.ingest(
        SYSTEM_USER,
        {
          sourceUri: entry.sourceUri ?? entry.file,
          title: entry.title,
          contentType: entry.contentType,
          scope: entry.scope,
          language: entry.language,
          changeSummary: entry.changeSummary,
        },
        readFileSync(entry.file),
        { publish: entry.publish ?? true },
      );
      ok++;
      console.log(
        `✓ ${entry.file} → v${result.versionNumber} (${result.chunkCount} chunks, ${result.published ? "published" : "draft"})`,
      );
    } catch (error) {
      if (error instanceof UnsupportedContentTypeError || error instanceof EmptyDocumentError) {
        console.error(`✗ ${entry.file}: ${error.message}`);
      } else {
        console.error(`✗ ${entry.file}:`, error);
      }
      process.exitCode = 1;
    }
  }
  console.log(`Ingestion complete: ${ok}/${manifest.length} document(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
/* eslint-enable no-console */
