/**
 * Deterministic, offline embedding provider for seed/CLI ingestion, tests, and local
 * dev (M1.1). It hashes word tokens into a fixed-dimension bag-of-words vector and
 * L2-normalizes — so cosine similarity is meaningful and identical text always yields
 * an identical vector, with no network or API key. Unicode-aware tokenization keeps it
 * usable for Vietnamese (Open Decision #9).
 *
 * This is NOT a semantic model: it captures lexical overlap only. The real
 * OpenAI/Vertex driver (same {@link EmbeddingProvider} contract, dimensions = 1536)
 * lands when network access is wired; swapping it is a provider change, not a rewrite.
 */

import type { EmbeddingProvider } from "../providers";

const DEFAULT_DIMENSIONS = 1536;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash → unsigned int. */
function fnv1a(token: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Lowercased Unicode letter/number runs (keeps Vietnamese diacritics as letters). */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hashing-dev";
  readonly dimensions: number;

  constructor(dimensions: number = DEFAULT_DIMENSIONS) {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error("HashingEmbeddingProvider: dimensions must be a positive integer");
    }
    this.dimensions = dimensions;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const bucket = hash % this.dimensions;
      // Signed contribution spreads tokens across +/- so unrelated docs decorrelate.
      const sign = (hash >>> 8) & 1 ? 1 : -1;
      vector[bucket] += sign;
    }

    let magnitude = 0;
    for (const value of vector) {
      magnitude += value * value;
    }
    if (magnitude === 0) {
      return vector; // empty / token-free text → zero vector
    }
    const norm = Math.sqrt(magnitude);
    return vector.map((value) => value / norm);
  }
}
