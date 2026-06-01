/**
 * Provider abstractions for the AI layer. Concrete OpenAI / Anthropic / Gemini
 * drivers (and the pgvector VectorStore driver) land in M1; P0.1 fixes the
 * contracts so the rest of the system can depend on stable interfaces.
 */

import type { RetrievalRequest } from "./retrieval/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletion {
  text: string;
  /** Tokens consumed, for the cost/usage logging tables. */
  usage: { promptTokens: number; completionTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<LlmCompletion>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  /**
   * Embed each input text. The returned array MUST be index-aligned and the same length
   * as `texts` (the i-th vector is the embedding of `texts[i]`), and every vector MUST
   * have {@link dimensions} elements. Callers store vectors against chunks positionally
   * and rely on this contract — a driver that batches/dedupes/drops inputs must restore
   * the original order and count before returning.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/** A retrieved knowledge chunk with its provenance, used by the citation builder. */
export interface RetrievedChunk {
  chunkId: string;
  documentVersionId: string;
  content: string;
  /** Fused relevance score (see the hybrid retriever's RRF). Higher = more relevant. */
  score: number;
  /** Raw cosine similarity, when the chunk matched the vector search. */
  vectorScore?: number;
  /** Raw keyword rank (`ts_rank`), when the chunk matched the keyword search. */
  keywordScore?: number;
}

/**
 * Retrieval boundary (M1.2). A driver runs hybrid retrieval — vector (pgvector cosine) +
 * keyword (Postgres full-text) + the {@link RetrievalRequest} metadata filters — and
 * returns chunks fused into a single ranked list. Swapping pgvector for Vertex/Qdrant
 * later is a driver change behind this interface, not a rewrite (PRD §Architecture).
 */
export interface VectorStore {
  retrieve(request: RetrievalRequest): Promise<RetrievedChunk[]>;
}
