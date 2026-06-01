import { z } from "zod";
import { languageSchema } from "./ingestion";
import { publishStatusSchema } from "./publish";
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

/**
 * Validated input for listing the experts a user can pick a voice from (M2.2 — "Ask Expert A"
 * vs "Ask Expert B"). The list surfaces only experts that have a *published* voice profile, so
 * a picker never offers a voice that can't actually answer (the eligibility is enforced in the
 * SQL, not here). Tenant isolation is enforced by Postgres RLS (directive §4.21), so there is
 * no `tenant_id` here either.
 *
 * `language` is intentionally OPTIONAL with no default: omitted lists every selectable expert,
 * while a value narrows to experts that have a published profile in that language (so the UI
 * can disable a voice that exists but not in the language the user is asking in).
 */
export const expertListQuerySchema = z.object({
  /** Narrow to experts with a published profile in this language. Omitted = all languages. */
  language: languageSchema.optional(),
  /** Max experts returned. Defaults to 20; higher ceiling than voice topK since it's a list. */
  limit: z.number().int().min(1).max(100).default(20),
});

export type ExpertListQueryInput = z.infer<typeof expertListQuerySchema>;

/**
 * Free-text fields of a voice profile, shared by the create + update inputs (M2.3). All three
 * are NFC-normalized at the boundary (directive §36): although a profile is not embedded, its
 * `guidelines` are injected into the answer prompt verbatim, so a decomposed Vietnamese string
 * would render inconsistently against the NFC-normalized facts/query the prompt builder emits.
 * Normalization is length-preserving for these scripts, so it runs after `.max()` safely.
 */
const profileName = z.string().trim().min(1).max(100).transform(normalizeText);
const profileDescription = z.string().trim().max(500).transform(normalizeText);
const profileGuidelines = z.string().trim().max(2000).transform(normalizeText);

/**
 * Validated input for authoring a *draft* voice profile (M2.3). An expert (or admin) creates the
 * profile they will later sign off on; the entry point for Open Decision #3's cold-start. The
 * profile is language-specific (EN + VI) — each `(expert, language)` profile is signed off
 * independently — and is always created in `draft`, so status is not accepted from the client.
 * Tenant isolation is enforced by Postgres RLS (directive §4.21), so `tenant_id` is absent here;
 * ownership (the actor may only author their own expert's profile) is enforced in the service.
 */
export const voiceProfileCreateSchema = z.object({
  /** The expert this voice profile renders. The actor must own this expert (or be an admin). */
  expertId: z.string().uuid(),
  /** Profile language — selects which language's voice this profile defines. Defaults to English. */
  language: languageSchema.default("en"),
  /** Human label for the profile (e.g. "Dr. Lan — direct, practical"). */
  name: profileName,
  /** Optional longer description of the voice for the authoring UI. */
  description: profileDescription.optional(),
  /** Distilled voice rules injected into the prompt builder (style-only, never facts). */
  guidelines: profileGuidelines.optional(),
});

export type VoiceProfileCreateInput = z.infer<typeof voiceProfileCreateSchema>;

/**
 * Validated input for editing a draft voice profile (M2.3). Only the free-text fields are
 * editable, and only while the profile is a `draft` (enforced in the service) — published
 * voices are immutable so a live answer's voice can't change underneath it. At least one field
 * must be present so an empty PATCH is rejected. `description`/`guidelines` accept an empty
 * string to clear the field (the service maps it to NULL).
 */
export const voiceProfileUpdateSchema = z
  .object({
    name: profileName.optional(),
    description: profileDescription.optional(),
    guidelines: profileGuidelines.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "at least one field must be provided",
  });

export type VoiceProfileUpdateInput = z.infer<typeof voiceProfileUpdateSchema>;

/**
 * Validated query for listing voice profiles in the sign-off workflow (M2.3). An expert sees
 * only their own profiles (scoped in the service); an admin sees all in the tenant. `status`
 * narrows to one lifecycle stage (e.g. `expert_review` for the sign-off queue). `limit` is
 * coerced because it arrives as a query-string value.
 */
export const voiceProfileListQuerySchema = z.object({
  /** Narrow to one lifecycle stage (e.g. `expert_review` = awaiting sign-off). */
  status: publishStatusSchema.optional(),
  /** Narrow to a single expert's profiles. */
  expertId: z.string().uuid().optional(),
  /** Narrow to one language. Omitted = all languages. */
  language: languageSchema.optional(),
  /** Max profiles returned. Defaults to 50. */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type VoiceProfileListQueryInput = z.infer<typeof voiceProfileListQuerySchema>;
