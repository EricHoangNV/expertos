/**
 * Provider abstractions for the AI layer. Concrete OpenAI / Anthropic / Gemini
 * drivers (and the pgvector VectorStore driver) land in M1; P0.1 fixes the
 * contracts so the rest of the system can depend on stable interfaces.
 */

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
  embed(texts: string[]): Promise<number[][]>;
}

/** A retrieved knowledge chunk with its provenance, used by the citation builder. */
export interface RetrievedChunk {
  chunkId: string;
  documentVersionId: string;
  content: string;
  score: number;
}

export interface VectorStore {
  query(embedding: number[], topK: number): Promise<RetrievedChunk[]>;
}
