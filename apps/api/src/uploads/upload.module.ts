import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  createDefaultEmbeddingProvider,
  createDefaultParserRegistry,
} from "../ingestion/ingestion.defaults";
import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";
import {
  MALWARE_SCANNER,
  STORAGE_PROVIDER,
  UPLOAD_EMBEDDING_PROVIDER,
  UPLOAD_PARSER_REGISTRY,
} from "./upload.tokens";
import {
  createDefaultMalwareScanner,
  createDefaultStorageProvider,
} from "./upload.defaults";

/**
 * Wires query-time document upload (M5.1/M5.2). `AuthModule` supplies {@link RlsService} (the
 * upload persistence boundary); `UsageLogService`/`StructuredLogger` come from the global
 * `ObservabilityModule`. Storage + malware-scan drivers come from offline-default factories behind
 * their DI tokens (production swaps a GCS store + ClamAV/VirusTotal scanner in one place). The
 * persistent/temporary indexing path reuses the ingestion parser registry + embedding factories so
 * upload chunks share the expert-knowledge vector space (M5.2 indexing strategy).
 */
@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [
    UploadService,
    { provide: STORAGE_PROVIDER, useFactory: createDefaultStorageProvider },
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
