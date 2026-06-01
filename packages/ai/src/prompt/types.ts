/**
 * Prompt-builder contract (M2.1). The builder assembles the LLM message array that renders
 * an answer in an expert's voice while keeping facts authoritative — "voice on top of facts"
 * (PRD §"Expert voice layer", principle #5). These value types are declared independently
 * of the Prisma / shared schemas so `@expertos/ai` stays dependency-free (the same purity
 * rule the retrieval/ingestion code follows); the app layer maps its validated rows into them.
 */

import type { ChatMessage } from "../providers";

/** Answer language. Mirrors the `Language` enum; voice + content are language-aware (EN + VI). */
export type PromptLanguage = "en" | "vi";

/**
 * A single retrieved fact the answer must ground on. A subset of `RetrievedChunk` — the only
 * fields the prompt needs — so the builder can be fed straight from the retrieval seam. The
 * provenance (`chunkId` / `documentVersionId`) is carried through to {@link AnswerPrompt.citations}
 * so the M4 citation builder can resolve every emitted `[n]` marker back to a real chunk.
 *
 * A fact may also come from a user's own uploaded document (M5.4): such a fact carries an
 * `uploadChunkId` (instead of published-knowledge provenance — `chunkId`/`documentVersionId` are
 * empty for it), `kind: "upload"`, and a human-readable `sourceLabel` (e.g. `budget.xlsx · Q1!A2`).
 * These optional fields ride through {@link AnswerPrompt.citations} so the M4 builder resolves an
 * upload citation the same way it resolves a knowledge one, just with a different source class.
 */
export interface PromptFact {
  chunkId: string;
  documentVersionId: string;
  content: string;
  /** Source class for the M5.4 upload-vs-knowledge citation distinction. Defaults to `"knowledge"`. */
  kind?: "knowledge" | "upload";
  /** `upload_chunk` id when this fact came from a user upload (M5.4); absent for knowledge. */
  uploadChunkId?: string;
  /** Human-readable provenance for an uploaded source (M5.4): `filename · sheet!cell`. */
  sourceLabel?: string;
}

/**
 * The distilled voice layer injected into the system prompt. Sourced from a published
 * `VoiceProfile`. Absent on the answer input = neutral voice; facts are still enforced.
 */
export interface VoiceProfileInput {
  /** Expert display name, for the mandatory "AI rendition of [Expert]" framing. */
  expertName: string;
  /** Distilled do/don't voice rules (`VoiceProfile.guidelines`). Shapes tone only, never facts. */
  guidelines?: string | null;
}

/**
 * An expert-authored example of how they phrase answers — a few-shot voice anchor retrieved
 * at runtime per topic. It is a STYLE reference only: the builder labels it as such so the
 * model never lifts a claim or number out of an example as if it were a retrieved fact.
 */
export interface VoiceExampleInput {
  /** The question/topic the example answered, if known. */
  prompt?: string | null;
  content: string;
}

export interface AnswerPromptInput {
  /** The end user's question (already sanitized + NFC-normalized at the API boundary). */
  query: string;
  /** Retrieved facts — the ONLY admissible source of claims, numbers, names and recommendations. */
  facts: PromptFact[];
  /** Optional voice layer. Omitted = neutral voice. */
  voice?: VoiceProfileInput;
  /** Optional retrieved voice examples (few-shot style anchors). */
  voiceExamples?: VoiceExampleInput[];
  /** Answer language. Defaults to `en`. */
  language?: PromptLanguage;
}

/**
 * The built prompt. `messages` goes straight to {@link LlmProvider.complete}; `citations`
 * is the source list in citation order — the marker `[i + 1]` in the model's answer resolves
 * to `citations[i]`, the contract the M4 citation builder relies on to guarantee resolvability.
 */
export interface AnswerPrompt {
  messages: ChatMessage[];
  citations: PromptFact[];
}
