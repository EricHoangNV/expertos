/**
 * DI tokens for the swappable upload-pipeline parts (M5.1). The defaults wired in
 * {@link UploadModule} are offline/deterministic (in-memory storage, EICAR-signature scanner);
 * production swaps a GCS storage driver and a ClamAV/VirusTotal scanner behind the same tokens,
 * not the pipeline — mirroring the ingestion `EMBEDDING_PROVIDER`/`SUMMARIZER` pattern.
 */
export const STORAGE_PROVIDER = "UPLOAD_STORAGE_PROVIDER";
export const MALWARE_SCANNER = "UPLOAD_MALWARE_SCANNER";

/**
 * Indexing parts for persistent/temporary upload chunking (M5.2). The parser registry and
 * embedding provider come from the *same* ingestion factories so an uploaded file's chunk vectors
 * land in the same space as expert-knowledge chunks and the query embedder — otherwise retrieval
 * over uploads would be meaningless (the query/chunk embedders must share one model).
 */
export const UPLOAD_PARSER_REGISTRY = "UPLOAD_PARSER_REGISTRY";
export const UPLOAD_EMBEDDING_PROVIDER = "UPLOAD_EMBEDDING_PROVIDER";
