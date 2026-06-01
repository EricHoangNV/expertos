import type { RetrievalLanguage } from "@expertos/ai";
import type { PublishStatusValue } from "@expertos/shared";

/**
 * A voice profile as seen by the sign-off workflow (M2.3) — the authoring/review surface, as
 * opposed to {@link VoiceProfileMeta} which is the trimmed shape the runtime prompt builder
 * needs. Carries the lifecycle `status` and the sign-off provenance (`approvedBy`/`approvedAt`)
 * so the expert/admin portal can render the review queue and "signed off by … on …".
 */
export interface VoiceProfileSummary {
  id: string;
  expertId: string;
  expertName: string;
  language: RetrievalLanguage;
  name: string;
  description: string | null;
  guidelines: string | null;
  status: PublishStatusValue;
  approvedBy: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
}

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

/**
 * A selectable expert voice for the picker (M2.2 — "Ask Expert A" vs "Ask Expert B"). Only
 * experts that are *active* and have at least one *published* voice profile are listed, so the
 * UI never offers a voice that cannot answer; `hasActiveProfile` is therefore always `true` and
 * exists so the surface reads self-documenting on the client. `languages` is the set of
 * languages the expert has a published profile in, so the picker can disable a voice that exists
 * but not in the language the user is asking in.
 */
export interface ExpertVoiceMeta {
  expertId: string;
  displayName: string;
  languages: RetrievalLanguage[];
  hasActiveProfile: true;
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
