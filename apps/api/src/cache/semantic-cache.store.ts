import { Prisma } from "@expertos/db";
import type { CachedAnswer, CachedCitation } from "./cache.types";

/** A semantic-cache lookup, scoped to one tenant + model tier and bounded by entry age. */
interface SemanticCacheLookup {
  tenantId: string;
  /** The composite answer-cache key (query + scope + voice + language). */
  normalizedQuestion: string;
  /** Model tier — part of the key so a degraded answer never serves a standard-tier user (M6.3). */
  model: string;
  /** Ignore entries created before this instant (TTL — stale knowledge protection). */
  notOlderThan: Date;
}

/** A write-through of a freshly generated answer into the persistent cache. */
interface SemanticCacheWrite {
  tenantId: string;
  normalizedQuestion: string;
  model: string;
  answer: CachedAnswer;
}

/**
 * The persistent (cross-instance, restart-surviving) tier of the M6.4 answer cache, backed by the
 * `semantic_cache` table. On Cloud Run scale-to-zero the in-process LRU is cold often, so this is
 * the durable layer that protects margin across instances; it is consulted only when the in-process
 * answer cache misses, and warms it on a hit.
 *
 * It is constructed per-call with the active RLS transaction — mirroring {@link PgVectorStore} /
 * {@link PgUploadChunkStore} — so tenant isolation is enforced by Postgres (`semantic_cache` is a
 * `tenant_only` table). Matching is **exact** on the normalized key + model for now; the embedding
 * column and its HNSW index are reserved for the *approximate* (cosine-similarity) match, which —
 * like every other pgvector path here — needs the real embedder and lands with the M11 integration
 * pass rather than offline.
 */
export class PgSemanticCacheStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** Returns the freshest live cached answer for the key, incrementing its hit counter, or null. */
  async lookup(params: SemanticCacheLookup): Promise<CachedAnswer | null> {
    const row = await this.tx.semanticCacheEntry.findFirst({
      where: {
        tenantId: params.tenantId,
        normalizedQuestion: params.normalizedQuestion,
        model: params.model,
        createdAt: { gte: params.notOlderThan },
        // Only entries with a stored payload are servable (a row could exist with citations NULL
        // if a future writer skips it); our writes always set it, so this is defensive.
        citations: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, answer: true, model: true, citations: true },
    });
    if (!row) {
      return null;
    }

    await this.tx.semanticCacheEntry.update({
      where: { id: row.id },
      data: { hits: { increment: 1 } },
    });

    const citations = (row.citations ?? []) as unknown as CachedCitation[];
    return {
      text: row.answer,
      model: row.model ?? params.model,
      sourceVersionIds: deriveSourceVersionIds(citations),
      citations,
    };
  }

  /**
   * Replaces any prior entry for the key with the new answer (one live row per key — older rows
   * would only ever be shadowed by the freshest, and age out by TTL otherwise). Runs in the caller's
   * RLS transaction, so the delete + insert are atomic.
   */
  async store(params: SemanticCacheWrite): Promise<void> {
    await this.tx.semanticCacheEntry.deleteMany({
      where: {
        tenantId: params.tenantId,
        normalizedQuestion: params.normalizedQuestion,
        model: params.model,
      },
    });
    await this.tx.semanticCacheEntry.create({
      data: {
        tenantId: params.tenantId,
        normalizedQuestion: params.normalizedQuestion,
        model: params.model,
        answer: params.answer.text,
        chunkIds: params.answer.citations
          .map((c) => c.chunkId)
          .filter((id) => id.length > 0),
        citations: params.answer.citations as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

/** De-dupes the non-empty document-version ids of a cached answer's citations (provenance). */
function deriveSourceVersionIds(citations: CachedCitation[]): string[] {
  return [
    ...new Set(
      citations.map((c) => c.documentVersionId).filter((id) => id.length > 0),
    ),
  ];
}
