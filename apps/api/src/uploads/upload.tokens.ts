/**
 * DI tokens for the swappable upload-pipeline parts (M5.1). The defaults wired in
 * {@link UploadModule} are offline/deterministic (in-memory storage, EICAR-signature scanner);
 * production swaps a GCS storage driver and a ClamAV/VirusTotal scanner behind the same tokens,
 * not the pipeline — mirroring the ingestion `EMBEDDING_PROVIDER`/`SUMMARIZER` pattern.
 */
export const STORAGE_PROVIDER = "UPLOAD_STORAGE_PROVIDER";
export const MALWARE_SCANNER = "UPLOAD_MALWARE_SCANNER";
