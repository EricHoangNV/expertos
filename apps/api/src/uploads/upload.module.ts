import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  createDefaultEmbeddingProvider,
  createDefaultParserRegistry,
} from "../ingestion/ingestion.defaults";
import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";
import { StorageModule } from "./storage.module";
import {
  MALWARE_SCANNER,
  UPLOAD_EMBEDDING_PROVIDER,
  UPLOAD_PARSER_REGISTRY,
} from "./upload.tokens";
import { createDefaultMalwareScanner } from "./upload.defaults";

/**
 * Wires query-time document upload (M5.1/M5.2). `AuthModule` supplies {@link RlsService} (the
 * upload persistence boundary); `UsageLogService`/`StructuredLogger` come from the global
 * `ObservabilityModule`. The object store comes from the shared {@link StorageModule} (so the
 * upload write path and the retention/user-deletion cleanup paths operate on one provider); the
 * malware-scan driver comes from an offline-default factory behind its DI token (production swaps a
 * GCS store + ClamAV/VirusTotal scanner in one place). The persistent/temporary indexing path reuses
 * the ingestion parser registry + embedding factories so upload chunks share the expert-knowledge
 * vector space (M5.2 indexing strategy).
 */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [UploadController],
  providers: [
    UploadService,
    { provide: MALWARE_SCANNER, useFactory: createDefaultMalwareScanner },
    { provide: UPLOAD_PARSER_REGISTRY, useFactory: createDefaultParserRegistry },
    {
      provide: UPLOAD_EMBEDDING_PROVIDER,
      useFactory: createDefaultEmbeddingProvider,
    },
  ],
  exports: [UploadService],
})
export class UploadModule {}
