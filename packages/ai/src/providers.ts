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

/**
 * One frame of a streamed completion (M3.1). A driver yields any number of `delta`-bearing
 * chunks (the incremental answer text) and exactly one terminal chunk carrying `usage` — the
 * same token counts {@link LlmCompletion} reports — so the chat layer can stream prose to the
 * client and still record cost once generation finishes. The concatenation of every `delta`
 * MUST equal the `text` a non-streamed {@link LlmProvider.complete} would return for the same
 * messages, so streaming and non-streaming paths stay interchangeable.
 */
export interface LlmStreamChunk {
  /** Incremental answer text. Absent on the terminal usage-only frame. */
  delta?: string;
  /** Present only on the final frame: total token usage for the completion. */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Per-request tuning the chat layer threads into a single completion (M17.3). Both fields are
 * optional overrides sourced from the admin runtime answer-tuning settings; when omitted the driver
 * uses its own configured defaults (the provider's default temperature; `this.name` as the model).
 * Threading these per-call — rather than rebuilding the provider — lets a Save take effect on the
 * next message with no restart. The chat layer records the *effective* model (`options.model ??
 * provider.name`) for cost logging, so the pricing table entry matches what was actually called.
 */
export interface LlmCallOptions {
  /** Sampling temperature for this call; lower = more deterministic. Omitted = provider default. */
  temperature?: number;
  /** Model id override for this call. Omitted = the driver's configured {@link LlmProvider.name}. */
  model?: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options?: LlmCallOptions): Promise<LlmCompletion>;
  /**
   * Optional streaming variant. When present, the chat layer streams `delta`s to the client and
   * reads the terminal frame's `usage`; when absent, the caller falls back to {@link complete}.
   * Optional so providers (and the M2 voice-eval harness) that only need `complete` are unaffected.
   */
  completeStream?(messages: ChatMessage[], options?: LlmCallOptions): AsyncIterable<LlmStreamChunk>;
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
