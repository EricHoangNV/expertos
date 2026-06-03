import { z } from "zod";
import { contentScopeSchema, languageSchema } from "./ingestion";
import { normalizeText } from "./text";

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
  /**
   * Expert-knowledge boundary (Security Cycle 2): when an expert voice is selected, ground the
   * answer only in that expert's own published knowledge **plus** unattributed/global knowledge —
   * never another expert's. A document is "the expert's" when its `expert_id` matches; documents
   * with no `expert_id` are the shared global corpus available to every voice. Omitted (neutral
   * voice) = no expert restriction. The driver resolves this via a join back to `documents`.
   */
  expertId: z.string().uuid().optional(),
});

export type RetrievalFilters = z.infer<typeof retrievalFiltersSchema>;

export const retrievalQuerySchema = z.object({
  /**
   * Query text — used for keyword matching and (after embedding) vector search. Trimmed,
   * length-bounded, then NFC-normalized so Vietnamese diacritics tokenize consistently across
   * both retrieval paths (Open Decision #9). NFC is length-preserving for these scripts, so
   * normalizing after `.max()` cannot smuggle the result back over the bound.
   */
  text: z.string().trim().min(1).max(2000).transform(normalizeText),
  /** Max results returned after fusion. */
  topK: z.number().int().min(1).max(50).default(8),
  filters: retrievalFiltersSchema.default({}),
});

export type RetrievalQueryInput = z.infer<typeof retrievalQuerySchema>;
