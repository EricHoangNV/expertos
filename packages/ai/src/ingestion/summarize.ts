/**
 * Per-chunk summarization for the ingestion pipeline (M1.1).
 *
 * Behind a {@link Summarizer} interface so the offline-deterministic extractive
 * default ({@link ExtractiveSummarizer}) can be swapped for an LLM-backed one
 * ({@link LlmSummarizer}) in production without touching the pipeline. The summary
 * feeds the `chunks.summary` column and, later, retrieval reranking.
 */

import type { LlmProvider } from "../providers";

export interface Summarizer {
  summarize(text: string): Promise<string>;
}

export interface ExtractiveOptions {
  /** Maximum leading sentences to keep. */
  maxSentences?: number;
  /** Hard character cap on the produced summary. */
  maxChars?: number;
}

const DEFAULT_MAX_SENTENCES = 2;
const DEFAULT_MAX_CHARS = 320;

/** Sentence-ish splitter: runs of non-terminator chars ending in `.`/`!`/`?` or the tail. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
}

/**
 * Extractive summary: the leading sentences of `text`, capped by sentence count and
 * characters. Deterministic and dependency-free — the default for seed/CLI ingestion.
 */
export function extractiveSummary(
  text: string,
  options: ExtractiveOptions = {},
): string {
  const maxSentences = options.maxSentences ?? DEFAULT_MAX_SENTENCES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") {
    return "";
  }

  let out = "";
  let used = 0;
  for (const raw of sentences(clean)) {
    if (used >= maxSentences) {
      break;
    }
    const sentence = raw.trim();
    const candidate = out === "" ? sentence : `${out} ${sentence}`;
    if (candidate.length > maxChars) {
      // First sentence already over the cap → hard-truncate it; otherwise stop here.
      return out === "" ? candidate.slice(0, maxChars).trim() : out;
    }
    out = candidate;
    used++;
  }
  return out;
}

export class ExtractiveSummarizer implements Summarizer {
  constructor(private readonly options?: ExtractiveOptions) {}

  summarize(text: string): Promise<string> {
    return Promise.resolve(extractiveSummary(text, this.options));
  }
}

/**
 * LLM-backed summarizer. Production swap-in: same {@link Summarizer} contract, so the
 * pipeline is unchanged. Empty input short-circuits without a model call.
 */
export class LlmSummarizer implements Summarizer {
  constructor(
    private readonly llm: LlmProvider,
    private readonly maxWords = 60,
  ) {}

  async summarize(text: string): Promise<string> {
    if (text.trim() === "") {
      return "";
    }
    const completion = await this.llm.complete([
      {
        role: "system",
        content: `Summarize the passage in ${this.maxWords} words or fewer. Output only the summary, no preamble.`,
      },
      { role: "user", content: text },
    ]);
    return completion.text.trim();
  }
}
