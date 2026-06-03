/**
 * Object-storage seam for uploads (M5.1). The pipeline persists raw bytes behind this single
 * contract and records the returned URI on `uploaded_files.gcs_uri`, so the rest of the app never
 * knows whether bytes live in GCS, S3, or memory. Production swaps a GCS driver behind the
 * `STORAGE_PROVIDER` token (PRD §"Security": signed, time-limited URLs) without touching callers.
 */
interface StoragePutInput {
  /** Logical object key (no bucket), e.g. `uploads/<userId>/<uuid>/<filename>`. */
  key: string;
  content: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  /** Persist bytes and return the storage URI to record on the row. */
  put(input: StoragePutInput): Promise<string>;
  /**
   * Delete the object previously persisted at `uri` — the exact value {@link put} returned and the
   * row recorded on `uploaded_files.gcs_uri`. This closes the Security-Cycle-2 gap where retention
   * and user-deletion dropped DB rows but left the raw objects behind: the {@link RetentionService}
   * sweep and the {@link AdminUserService} GDPR cascade call it for every expiring/owned upload.
   *
   * **Idempotent:** deleting a missing or already-deleted object is a no-op, not an error, so a
   * re-run of the sweep is safe. Callers invoke it best-effort *after* the rows are committed gone
   * (an orphaned object is recoverable; aborting the purge on a storage hiccup is not).
   */
  delete(uri: string): Promise<void>;
}

const MEMORY_SCHEME = "memory://";

/**
 * Offline, in-process storage default — mirrors the `EchoLlmProvider`/`HashingEmbeddingProvider`
 * pattern so the upload pipeline runs end-to-end without GCS or network. Bytes are held in memory
 * keyed by object key (retrievable when M5.2/M5.3 add parsing) and a `memory://` URI is returned.
 */
export class InMemoryStorageProvider implements StorageProvider {
  readonly name = "in-memory";
  private readonly objects = new Map<string, Buffer>();

  async put(input: StoragePutInput): Promise<string> {
    this.objects.set(input.key, input.content);
    return `${MEMORY_SCHEME}${input.key}`;
  }

  async delete(uri: string): Promise<void> {
    // Map the stored `memory://<key>` URI back to its object key (tolerate a bare key too).
    const key = uri.startsWith(MEMORY_SCHEME) ? uri.slice(MEMORY_SCHEME.length) : uri;
    this.objects.delete(key);
  }
}
