import { Module } from "@nestjs/common";
import { STORAGE_PROVIDER } from "./upload.tokens";
import { createDefaultStorageProvider } from "./upload.defaults";

/**
 * Shared object-storage seam. Provides the single {@link STORAGE_PROVIDER} instance behind the
 * upload pipeline (M5.1) so every consumer — the upload write path *and* the retention/user-deletion
 * cleanup paths (Security Cycle 2: raw objects must be deleted with their rows) — operate on one
 * store. Because the factory is registered once here and the module is imported (not re-providing the
 * factory), `put` and `delete` hit the same backing store. Production swaps the GCS driver in
 * {@link createDefaultStorageProvider} without touching any importer.
 */
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useFactory: createDefaultStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
