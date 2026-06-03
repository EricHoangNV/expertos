import type { StorageProvider } from "./storage-provider";
import type { StructuredLogger } from "../observability/logger.service";

/**
 * Best-effort deletion of raw storage objects after their DB rows are committed gone (Security
 * Cycle 2: retention + user-deletion must reclaim the objects, not just the rows). Call this
 * *outside* the deleting transaction — the rows are the source of truth, so drop them first and
 * reclaim the bytes after. A storage failure is logged and swallowed: an orphaned object is
 * recoverable and the next sweep retries it (delete is idempotent), whereas aborting would leave the
 * rows undeleted. A null/empty URI (a row that never recorded a `gcs_uri`) is skipped.
 *
 * @returns how many objects were successfully deleted (for the audit/log trail).
 */
export async function deleteStorageObjects(
  storage: StorageProvider,
  uris: ReadonlyArray<string | null | undefined>,
  logger: StructuredLogger,
  context: Record<string, unknown> = {},
): Promise<number> {
  let deleted = 0;
  for (const uri of uris) {
    if (!uri) continue;
    try {
      await storage.delete(uri);
      deleted += 1;
    } catch (err) {
      logger.warn("storage object delete failed", {
        ...context,
        uri,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return deleted;
}
