/**
 * DI token for the voice-side embedding provider (M2.1). Voice examples are embedded when
 * they are authored (admin/seed) and the query topic is embedded at retrieval time; both MUST
 * use the same model or the cosine match is meaningless. It therefore resolves from the same
 * `createDefaultEmbeddingProvider` factory as ingestion + knowledge retrieval — change that
 * one factory when the production embedder lands and all three move together.
 */
export const VOICE_EMBEDDING_PROVIDER = "VOICE_EMBEDDING_PROVIDER";
