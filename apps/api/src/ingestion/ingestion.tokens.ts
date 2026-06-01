/**
 * DI tokens for the swappable pipeline parts (M1.1). The defaults wired in
 * {@link IngestionModule} are offline/deterministic (hashing embedder, extractive
 * summarizer); production swaps the provider behind the same token, not the pipeline.
 */
export const PARSER_REGISTRY = "INGESTION_PARSER_REGISTRY";
export const EMBEDDING_PROVIDER = "INGESTION_EMBEDDING_PROVIDER";
export const SUMMARIZER = "INGESTION_SUMMARIZER";
