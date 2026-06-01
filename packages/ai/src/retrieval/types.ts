/**
 * Hybrid-retrieval contract (M1.2). These value unions mirror the Prisma `ContentScope`
 * / `Language` / `ChunkStatus` enums and the `@expertos/shared` zod schemas, but are
 * declared independently so `@expertos/ai` stays dependency-free (same purity rule the
 * ingestion code follows). The app layer maps shared's validated filters into these
 * types — TypeScript fails the build if the unions ever drift apart.
 */

export type RetrievalScope =
  | "global_expert"
  | "shared_expert"
  | "tenant_customer"
  | "user_private"
  | "temporary_upload";

export type RetrievalLanguage = "en" | "vi";

export type RetrievalStatus = "pending" | "published" | "archived";

/**
 * Metadata gate applied to every retrieval query. `tenant_id` is intentionally absent —
 * Postgres RLS enforces tenant isolation structurally, so the driver never expresses it.
 */
export interface RetrievalFilters {
  /** Restrict to these content scopes. Omitted = no scope restriction. */
  scope?: RetrievalScope[];
  /** Restrict to a single content language. Omitted = any language. */
  language?: RetrievalLanguage;
  /** Publication-status gate; the driver always receives a resolved value. */
  status: RetrievalStatus;
}

export interface RetrievalRequest {
  /** Raw query text — drives keyword matching. */
  text: string;
  /** Query embedding; dimension must match the stored chunk vectors. */
  embedding: number[];
  /** Max results returned after fusion. */
  topK: number;
  filters: RetrievalFilters;
}

/** A single-modality hit (one ranked list from vector OR keyword search). */
export interface RankedChunk {
  chunkId: string;
  documentVersionId: string;
  content: string;
  /** Raw per-modality score (cosine similarity, or keyword rank). */
  score: number;
}
