/**
 * RAG retrieval eval harness contracts (M1.3 / PRD §"LLM/RAG eval harness").
 *
 * The harness measures whether hybrid retrieval surfaces the right knowledge for a query,
 * using the same pure primitives as production (chunk → embed → cosine + keyword → RRF fuse)
 * so it is fully deterministic and runs in CI with no database. With the offline
 * {@link HashingEmbeddingProvider} it locks in *lexical/tokenization/fusion* correctness —
 * crucially the Vietnamese normalization behavior of Open Decision #9 — and regression-guards
 * it. The same golden set, run out-of-band against the real multilingual embedding model,
 * yields the *semantic* quality numbers (true cross-lingual recall) that no offline lexical
 * model can produce; see {@link EvalOptions.embedder}.
 */

import type { ChunkOptions } from "../ingestion/chunk";
import type { EmbeddingProvider } from "../providers";
import type { FusionOptions } from "../retrieval/fusion";
import type { RetrievalLanguage } from "../retrieval/types";

/** A knowledge document in the golden corpus. Chunked by the harness before indexing. */
export interface EvalDocument {
  id: string;
  content: string;
  /** Annotation only — the harness does not language-filter (cross-lingual by default). */
  language?: RetrievalLanguage;
}

/** A query plus the set of documents that *should* be retrieved for it. */
export interface EvalCase {
  id: string;
  query: string;
  /** Document ids considered relevant. Recall/precision/MRR are scored against this set. */
  relevantDocIds: string[];
  /** Annotation only — describes the case's language for reporting. */
  language?: RetrievalLanguage;
  /** Free-text note explaining what the case exercises. */
  note?: string;
}

export interface EvalGoldenSet {
  documents: EvalDocument[];
  cases: EvalCase[];
}

export interface EvalOptions {
  /** Embedding model. Defaults to the deterministic offline {@link HashingEmbeddingProvider}. */
  embedder?: EmbeddingProvider;
  /** Results kept per query after fusion. Default 8 (mirrors the production retrieval default). */
  topK?: number;
  /** Chunking parameters for the corpus. Defaults match the ingestion pipeline. */
  chunk?: ChunkOptions;
  /** RRF fusion tuning, passed straight to `fuseHybrid`. */
  fusion?: FusionOptions;
}

/** Per-query scoring. `retrievedDocIds` is the deduped, rank-ordered top-K document list. */
export interface EvalCaseResult {
  caseId: string;
  /** True when at least one relevant document appears in the top-K. */
  hit: boolean;
  /** Fraction of the relevant set retrieved in the top-K (`[0,1]`). */
  recallAtK: number;
  /** Fraction of retrieved documents that are relevant (`[0,1]`). */
  precisionAtK: number;
  /** `1 / rank` of the first relevant document (0 if none retrieved). */
  reciprocalRank: number;
  retrievedDocIds: string[];
}

/** Aggregate report over all cases. */
export interface EvalReport {
  topK: number;
  /** Name of the embedding model used, for provenance in out-of-band runs. */
  embedder: string;
  cases: EvalCaseResult[];
  /** Fraction of cases with at least one relevant hit. */
  hitRate: number;
  meanRecallAtK: number;
  meanPrecisionAtK: number;
  /** Mean reciprocal rank across cases. */
  mrr: number;
}
