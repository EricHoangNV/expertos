import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";
import { MALWARE_SCANNER, STORAGE_PROVIDER } from "./upload.tokens";
import {
  createDefaultMalwareScanner,
  createDefaultStorageProvider,
} from "./upload.defaults";

/**
 * Wires query-time document upload (M5.1). `AuthModule` supplies {@link RlsService} (the upload
 * persistence boundary); `StructuredLogger` comes from the global `ObservabilityModule`. The
 * storage + malware-scan drivers come from offline-default factories behind their DI tokens, so
 * production swaps a GCS store + ClamAV/VirusTotal scanner in one place (mirroring the ingestion
 * pipeline's provider factories).
 */
@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [
    UploadService,
    { provide: STORAGE_PROVIDER, useFactory: createDefaultStorageProvider },
    { provide: MALWARE_SCANNER, useFactory: createDefaultMalwareScanner },
  ],
  exports: [UploadService],
})
export class UploadModule {}
