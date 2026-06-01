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
}

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
    return `memory://${input.key}`;
  }
}
