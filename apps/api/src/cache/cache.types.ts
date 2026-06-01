/**
 * Shared value shapes for the M6.4 caching layers. Kept separate from the services so the
 * in-process answer cache, the persistent {@link PgSemanticCacheStore}, and the chat consumer all
 * agree on exactly what a cached answer carries.
 */

/**
 * One resolved citation of a cached answer. Mirrors the relevant fields of the `@expertos/ai`
 * `ResolvedCitation` so a cache hit can rebuild both the `done` event's `ChatCitationDto` and the
 * persisted citation row faithfully. Cacheable turns are knowledge-only (uploads make an answer
 * user-private, so they are never cached — see {@link ResponseCacheService}), hence no
 * `uploadChunkId` / `sourceLabel`: every cached citation resolves to published expert knowledge.
 */
export interface CachedCitation {
  /** The marker the model wrote (`[ordinal]`); preserved, so a sparse list stays faithful. */
  ordinal: number;
  chunkId: string;
  documentVersionId: string;
  /** Full chunk content — sliced to a preview for the `done` event, stored whole for persistence. */
  content: string;
}

/** A fully resolved, replayable answer for a query — the unit both cache layers store. */
export interface CachedAnswer {
  /** The sanitized answer text (unresolvable markers already stripped — M4.1). */
  text: string;
  /** The model that generated it; part of the cache key so a tier never serves another's answer. */
  model: string;
  /** `document_version` ids that grounded the answer (provenance), de-duped. */
  sourceVersionIds: string[];
  /** Resolved citations in marker order. */
  citations: CachedCitation[];
}
