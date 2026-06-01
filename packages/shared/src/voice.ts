import { z } from "zod";
import { languageSchema } from "./ingestion";
import { normalizeText } from "./text";

/**
 * Validated input for runtime voice-example retrieval (M2.1). Given an expert and the user's
 * topic, the voice layer retrieves the most similar expert-authored examples ("this is how
 * the expert phrases things") to anchor the answer's tone — separate from, and on top of, the
 * factual knowledge retrieval (PRD §"Expert voice layer"). Tenant isolation is enforced by
 * Postgres RLS (directive §4.21), so `tenant_id` is intentionally absent here.
 *
 * Voice profiles are language-specific (EN + VI), so `language` selects the profile to draw
 * from and defaults to English. Query `text` is NFC-normalized at the boundary for the same
 * reason knowledge queries are (directive §36 / Open Decision #9): the example embeddings are
 * built over NFC text, so a decomposed query would silently miss on Vietnamese.
 */
export const voiceQuerySchema = z.object({
  /** The expert whose voice to render. */
  expertId: z.string().uuid(),
  /**
   * Topic / question text used to retrieve the most relevant voice examples. Trimmed,
   * length-bounded, then NFC-normalized (length-preserving for these scripts, so normalizing
   * after `.max()` cannot push the result back over the bound).
   */
  text: z.string().trim().min(1).max(2000).transform(normalizeText),
  /** Voice-profile language to draw examples from. Defaults to English. */
  language: languageSchema.default("en"),
  /** Max voice examples returned. Kept small so the few-shot block can't crowd out facts. */
  topK: z.number().int().min(1).max(10).default(3),
});

export type VoiceQueryInput = z.infer<typeof voiceQuerySchema>;
