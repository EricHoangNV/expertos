import { z } from "zod";
import { contentScopeSchema, languageSchema } from "./ingestion";

/**
 * Validated input for hybrid knowledge retrieval (M1.2). The metadata filters here are
 * the tenant/user isolation contract from PRD §"Tenant/user isolation": every retrieval
 * query carries `status` (default `published` so unreviewed/archived chunks never surface
 * in an answer), optional `scope`, and optional `language`. The `tenant_id` filter is NOT
 * expressed here — Postgres RLS enforces it structurally (directive §4.21), so no query
 * has to remember it.
 *
 * Mirrors the `ChunkStatus` enum in the Prisma schema but is declared independently so
 * `@expertos/shared` stays free of a `@expertos/db` dependency (same pattern as
 * {@link ingestionInputSchema}).
 */

/** Chunk publication status. Only `published` is answer-eligible by default. */
export const CHUNK_STATUSES = ["pending", "published", "archived"] as const;
export const chunkStatusSchema = z.enum(CHUNK_STATUSES);
export type ChunkStatusValue = z.infer<typeof chunkStatusSchema>;

export const retrievalFiltersSchema = z.object({
  /** Restrict to these content scopes. Omitted = no scope restriction (RLS still applies). */
  scope: z.array(contentScopeSchema).nonempty().optional(),
  /** Restrict to a single content language. Omitted = any language (cross-lingual). */
  language: languageSchema.optional(),
  /** Publication status gate. Defaults to `published`. */
  status: chunkStatusSchema.default("published"),
});

export type RetrievalFilters = z.infer<typeof retrievalFiltersSchema>;

export const retrievalQuerySchema = z.object({
  /** Raw query text — used for keyword matching and (after embedding) vector search. */
  text: z.string().trim().min(1).max(2000),
  /** Max results returned after fusion. */
  topK: z.number().int().min(1).max(50).default(8),
  filters: retrievalFiltersSchema.default({}),
});

export type RetrievalQueryInput = z.infer<typeof retrievalQuerySchema>;
