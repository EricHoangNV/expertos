import type { RetrievalLanguage } from "@expertos/ai";

/**
 * The voice profile metadata for an expert + language: the distilled guidelines plus the
 * display name the prompt builder needs for the "AI rendition of [Expert]" framing. Loaded
 * only for a *published* profile of an *active* expert.
 */
export interface VoiceProfileMeta {
  voiceProfileId: string;
  expertName: string;
  guidelines: string | null;
}

/** A retrieved voice example, ranked by cosine similarity to the query topic. */
export interface VoiceExampleHit {
  id: string;
  prompt: string | null;
  content: string;
  /** Cosine similarity to the query (higher = closer). */
  score: number;
}

/** Vector-search request for voice examples within a single resolved voice profile. */
export interface VoiceExampleRequest {
  voiceProfileId: string;
  embedding: number[];
  topK: number;
}

/**
 * The voice layer for one answer: the profile (or `null` when the expert has no published
 * profile in the requested language) and the topic-matched style examples. Field names line
 * up with the `@expertos/ai` prompt builder's `VoiceProfileInput` / `VoiceExampleInput`, so
 * the M3 chat layer can pass these straight through.
 */
export interface RetrievedVoice {
  profile: VoiceProfileMeta | null;
  examples: VoiceExampleHit[];
  language: RetrievalLanguage;
}
