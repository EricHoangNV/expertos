/**
 * Deterministic, database-free RAG retrieval eval runner (M1.3).
 *
 * It rebuilds the production retrieval path from the same pure primitives so a passing eval
 * means the real ranking is exercised, not a stand-in: documents are chunked with
 * {@link chunkText}, embedded with the injected {@link EmbeddingProvider}, then for each query
 * a vector list (cosine similarity, mirroring pgvector's `1 - (embedding <=> q)`) and a keyword
 * list (lexeme overlap, mirroring Postgres `to_tsvector('simple', …)` / `ts_rank`) are fused
 * with the production {@link fuseHybrid} (RRF). The keyword scorer is the offline approximation
 * of the Postgres full-text path — exact-lexeme, no stemming — which is sufficient to guard
 * tokenization/normalization/fusion behavior; the true `ts_rank` numbers are validated in the
 * Testcontainers integration eval (M11).
 *
 * Candidate over-fetch and the default top-K match {@link PgVectorStore} so fusion sees the
 * same shape of input it will in production.
 */

import { HashingEmbeddingProvider } from "../embedding/hashing-embedding-provider";
import { chunkText } from "../ingestion/chunk";
import type { EmbeddingProvider } from "../providers";
import { fuseHybrid } from "../retrieval/fusion";
import type { RankedChunk } from "../retrieval/types";
import { cosineSimilarity } from "../similarity";
import { tokenize } from "../text";
import { aggregate, scoreCase } from "./metrics";
import type {
  EvalCaseResult,
  EvalGoldenSet,
  EvalOptions,
  EvalReport,
} from "./types";

const DEFAULT_TOP_K = 8;
/** Over-fetch per modality so fusion has material to re-rank (mirrors PgVectorStore). */
const CANDIDATE_MULTIPLIER = 4;
const MAX_CANDIDATES = 200;

interface IndexedChunk {
  chunkId: string;
  documentVersionId: string;
  content: string;
  embedding: number[];
  /** Distinct lexemes, for the keyword-overlap score. */
  tokens: Set<string>;
}

export async function evaluateRetrieval(
  goldenSet: EvalGoldenSet,
  options: EvalOptions = {},
): Promise<EvalReport> {
  const embedder = options.embedder ?? new HashingEmbeddingProvider();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const candidates = Math.min(
    Math.max(topK * CANDIDATE_MULTIPLIER, topK),
    MAX_CANDIDATES,
  );

  const index = await buildIndex(goldenSet, embedder, options.chunk);

  const results: EvalCaseResult[] = [];
  for (const testCase of goldenSet.cases) {
    const [queryEmbedding] = await embedder.embed([testCase.query]);
    const queryTokens = new Set(tokenize(testCase.query));

    const vectorHits = rankByVector(index, queryEmbedding, candidates);
    const keywordHits = rankByKeyword(index, queryTokens, candidates);
    const fused = fuseHybrid(vectorHits, keywordHits, topK, options.fusion);

    const retrievedDocIds = dedupe(fused.map((hit) => hit.documentVersionId));
    results.push({
      caseId: testCase.id,
      retrievedDocIds,
      ...scoreCase(retrievedDocIds, testCase.relevantDocIds),
    });
  }

  return aggregate(topK, embedder.name, results);
}

async function buildIndex(
  goldenSet: EvalGoldenSet,
  embedder: EmbeddingProvider,
  chunkOptions: EvalOptions["chunk"],
): Promise<IndexedChunk[]> {
  const flat: Omit<IndexedChunk, "embedding" | "tokens">[] = [];
  for (const doc of goldenSet.documents) {
    chunkText(doc.content, chunkOptions).forEach((chunk) => {
      flat.push({
        chunkId: `${doc.id}#${chunk.index}`,
        documentVersionId: doc.id,
        content: chunk.content,
      });
    });
  }

  const embeddings = await embedder.embed(flat.map((chunk) => chunk.content));
  return flat.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
    tokens: new Set(tokenize(chunk.content)),
  }));
}

function rankByVector(
  index: IndexedChunk[],
  queryEmbedding: number[],
  limit: number,
): RankedChunk[] {
  return index
    .map((chunk) => toRanked(chunk, cosineSimilarity(queryEmbedding, chunk.embedding)))
    .sort(byScoreThenId)
    .slice(0, limit);
}

function rankByKeyword(
  index: IndexedChunk[],
  queryTokens: Set<string>,
  limit: number,
): RankedChunk[] {
  const hits: RankedChunk[] = [];
  for (const chunk of index) {
    let overlap = 0;
    for (const token of queryTokens) {
      if (chunk.tokens.has(token)) {
        overlap += 1;
      }
    }
    if (overlap > 0) {
      hits.push(toRanked(chunk, overlap));
    }
  }
  return hits.sort(byScoreThenId).slice(0, limit);
}

function toRanked(chunk: IndexedChunk, score: number): RankedChunk {
  return {
    chunkId: chunk.chunkId,
    documentVersionId: chunk.documentVersionId,
    content: chunk.content,
    score,
  };
}

/** Sort by score desc; chunkId tiebreak keeps candidate selection deterministic. */
function byScoreThenId(a: RankedChunk, b: RankedChunk): number {
  return b.score - a.score || a.chunkId.localeCompare(b.chunkId);
}

/** First-occurrence-wins dedupe, preserving rank order. */
function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
