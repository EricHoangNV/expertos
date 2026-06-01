/**
 * Deterministic text chunking for the ingestion pipeline (M1.1).
 *
 * A sliding word-window splitter with overlap: input text is tokenized to words and
 * sliced into fixed-size windows that overlap by a configurable amount so a passage
 * spanning a chunk boundary still appears whole in at least one chunk (improves
 * retrieval recall). Token counts are estimated, not exact — the real tokenizer lives
 * in the embedding provider; this estimate only drives the window budget and the
 * `chunks.token_count` column. Paragraph-aware chunking is a later refinement.
 */

/** Rough word→token ratio (~4 chars/token ≈ 0.75 words/token for English). */
const WORDS_PER_TOKEN = 0.75;

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 50;

export interface TextChunk {
  /** Zero-based position of the chunk within the document. */
  index: number;
  content: string;
  /** Estimated token count (see {@link estimateTokens}). */
  tokenCount: number;
}

export interface ChunkOptions {
  /** Maximum tokens per chunk. Must be positive. */
  maxTokens?: number;
  /** Tokens of overlap between consecutive chunks. Must be `>= 0` and `< maxTokens`. */
  overlapTokens?: number;
}

function words(text: string): string[] {
  const trimmed = text.trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

/** Estimate the token count of a string. Empty/whitespace text estimates to 0. */
export function estimateTokens(text: string): number {
  const count = words(text).length;
  return count === 0 ? 0 : Math.ceil(count / WORDS_PER_TOKEN);
}

/**
 * Split `text` into overlapping chunks sized by token budget. Returns `[]` for
 * empty/whitespace input. Whitespace (including newlines) is normalized to single
 * spaces within each chunk.
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  if (maxTokens <= 0) {
    throw new Error("chunkText: maxTokens must be positive");
  }
  if (overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new Error("chunkText: overlapTokens must be >= 0 and < maxTokens");
  }

  const all = words(text);
  if (all.length === 0) {
    return [];
  }

  const maxWords = Math.max(1, Math.floor(maxTokens * WORDS_PER_TOKEN));
  const overlapWords = Math.floor(overlapTokens * WORDS_PER_TOKEN);
  const step = Math.max(1, maxWords - overlapWords);

  const chunks: TextChunk[] = [];
  for (let start = 0, index = 0; start < all.length; start += step, index++) {
    const content = all.slice(start, start + maxWords).join(" ");
    chunks.push({ index, content, tokenCount: estimateTokens(content) });
    if (start + maxWords >= all.length) {
      break;
    }
  }
  return chunks;
}
