/**
 * OpenAI embeddings driver (the production counterpart of {@link HashingEmbeddingProvider}).
 *
 * Calls `POST /v1/embeddings` with `text-embedding-3-small` (1536-dim → matches the existing
 * `chunks.embedding vector(1536)` column + HNSW index, and is priced in `model-pricing.ts`). Unlike
 * the dev hashing embedder this is a real semantic model, so cosine similarity reflects meaning, not
 * lexical overlap. Network/key/gating lives in the factory ({@link createDefaultEmbeddingProvider} —
 * opt-in via `EMBEDDING_PROVIDER=openai`); this class is pure given an injected `fetch`.
 *
 * Contract guarantees (see {@link EmbeddingProvider}): the returned array is index-aligned with the
 * input and the same length. The API may return a batch's items out of order, so each item carries
 * its input `index`; we re-sort by that index per batch and concatenate batches in input order, so a
 * caller storing vectors against chunks positionally is never given a transposed vector.
 */
import type { EmbeddingProvider } from "../providers";
import { defaultFetch, LlmRequestError, type FetchLike } from "../llm/http";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
/** OpenAI accepts large input arrays, but we cap per-request batch size to bound payload + latency. */
const MAX_BATCH = 256;

export interface OpenAiEmbeddingConfig {
  apiKey: string;
  /** Model id; also reported as {@link EmbeddingProvider.name} for usage/pricing. Default `text-embedding-3-small`. */
  model?: string;
  /** Output dimensionality (v3 models support truncation); must match the DB column. Default 1536. */
  dimensions?: number;
  /** Override for tests / Azure / proxies. Default `https://api.openai.com/v1`. */
  baseUrl?: string;
  fetch?: FetchLike;
}

interface OpenAiEmbeddingItem {
  index?: number;
  embedding?: number[];
}
interface OpenAiEmbeddingResponse {
  data?: OpenAiEmbeddingItem[];
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetch: FetchLike;

  constructor(config: OpenAiEmbeddingConfig) {
    if (!config.apiKey) throw new Error("OpenAiEmbeddingProvider requires an apiKey");
    this.apiKey = config.apiKey;
    this.name = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.url = `${base}/embeddings`;
    this.fetch = config.fetch ?? defaultFetch();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out = new Array<number[]>(texts.length);
    for (let start = 0; start < texts.length; start += MAX_BATCH) {
      const batch = texts.slice(start, start + MAX_BATCH);
      const vectors = await this.embedBatch(batch);
      for (let i = 0; i < vectors.length; i++) out[start + i] = vectors[i];
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.name, input: batch, dimensions: this.dimensions }),
    });
    if (!res.ok) {
      throw new LlmRequestError("openai-embedding", res.status, await res.text());
    }

    let body: OpenAiEmbeddingResponse;
    try {
      body = JSON.parse(await res.text()) as OpenAiEmbeddingResponse;
    } catch {
      throw new LlmRequestError("openai-embedding", res.status, "response was not valid JSON");
    }
    const data = body.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new LlmRequestError(
        "openai-embedding",
        res.status,
        `expected ${batch.length} embeddings, got ${Array.isArray(data) ? data.length : "no data array"}`,
      );
    }

    // Restore input order from each item's `index` (the API may reorder within a batch).
    const ordered = new Array<number[] | undefined>(batch.length);
    for (const item of data) {
      const idx = item.index;
      if (idx == null || !Number.isInteger(idx) || idx < 0 || idx >= batch.length) {
        throw new LlmRequestError("openai-embedding", res.status, `embedding item has out-of-range index ${String(idx)}`);
      }
      if (!Array.isArray(item.embedding) || item.embedding.length !== this.dimensions) {
        throw new LlmRequestError(
          "openai-embedding",
          res.status,
          `embedding at index ${idx} has ${item.embedding?.length ?? "no"} dims, expected ${this.dimensions}`,
        );
      }
      ordered[idx] = item.embedding;
    }
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i] == null) {
        throw new LlmRequestError("openai-embedding", res.status, `missing embedding for input ${i}`);
      }
    }
    return ordered as number[][];
  }
}
