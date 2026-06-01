/**
 * DI token for the retrieval-side embedding provider (M1.2). It MUST resolve to the same
 * model the ingestion pipeline writes with (`EMBEDDING_PROVIDER`) so the query vector and
 * the stored chunk vectors live in one comparable vector space — both default to the
 * offline {@link HashingEmbeddingProvider} via `createDefaultEmbeddingProvider`.
 */
export const RETRIEVAL_EMBEDDING_PROVIDER = "RETRIEVAL_EMBEDDING_PROVIDER";
