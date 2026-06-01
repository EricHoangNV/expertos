import type { RetrievedChunk } from "../providers";
import type { RankedChunk } from "./types";

/**
 * Reciprocal Rank Fusion (RRF) of the vector and keyword result lists.
 *
 * RRF combines ranked lists by position rather than by raw score, so it is robust to the
 * vector (cosine, roughly [-1,1]) and keyword (`ts_rank`, unbounded small) scores living
 * on different, incomparable scales — no score normalization or hand-tuned blend weight is
 * needed. Each list contributes `weight / (k + rank)` per item (rank is 1-based); the
 * damping constant `k` (Cormack et al. default 60) keeps any single top hit from
 * dominating. The fused `score` is the sum of contributions; `vectorScore` / `keywordScore`
 * preserve the raw per-modality scores for transparency and debugging.
 */

const DEFAULT_K = 60;

export interface FusionOptions {
  /** RRF damping constant; larger = flatter weighting. Default 60. */
  k?: number;
  /** Relative weight of the vector list. Default 1. */
  vectorWeight?: number;
  /** Relative weight of the keyword list. Default 1. */
  keywordWeight?: number;
}

interface Accumulator extends RetrievedChunk {
  vectorScore?: number;
  keywordScore?: number;
}

export function fuseHybrid(
  vectorHits: RankedChunk[],
  keywordHits: RankedChunk[],
  topK: number,
  options: FusionOptions = {},
): RetrievedChunk[] {
  if (!Number.isFinite(topK) || topK <= 0) {
    return [];
  }

  const k = Number.isFinite(options.k) && (options.k as number) > 0 ? (options.k as number) : DEFAULT_K;
  const vectorWeight = Number.isFinite(options.vectorWeight) ? (options.vectorWeight as number) : 1;
  const keywordWeight = Number.isFinite(options.keywordWeight) ? (options.keywordWeight as number) : 1;

  const fused = new Map<string, Accumulator>();

  const accumulate = (
    hits: RankedChunk[],
    weight: number,
    assign: (entry: Accumulator, rawScore: number) => void,
  ): void => {
    hits.forEach((hit, index) => {
      const contribution = weight / (k + index + 1);
      const existing = fused.get(hit.chunkId);
      if (existing) {
        existing.score += contribution;
        assign(existing, hit.score);
      } else {
        const entry: Accumulator = {
          chunkId: hit.chunkId,
          documentVersionId: hit.documentVersionId,
          content: hit.content,
          score: contribution,
        };
        assign(entry, hit.score);
        fused.set(hit.chunkId, entry);
      }
    });
  };

  accumulate(vectorHits, vectorWeight, (entry, raw) => {
    entry.vectorScore = raw;
  });
  accumulate(keywordHits, keywordWeight, (entry, raw) => {
    entry.keywordScore = raw;
  });

  return Array.from(fused.values())
    // Sort by fused score desc; chunkId tiebreak keeps the order deterministic.
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, topK);
}
