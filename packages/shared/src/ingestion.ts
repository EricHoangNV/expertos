import { z } from "zod";

/**
 * Validated input for the knowledge ingestion pipeline (M1.1). Sanitizing /
 * length-bounding every field here (directive §1) keeps untrusted source metadata
 * from reaching the DB or the LLM unchecked. Mirrors the `ContentScope` / `Language`
 * enums in the Prisma schema but is declared independently so `@expertos/shared` stays
 * free of a `@expertos/db` dependency (same pattern as `roleSchema`).
 */

/** Retrieval-visibility scope. Consumer MVP uses `global_expert`; B2B flips on the rest. */
export const CONTENT_SCOPES = [
  "global_expert",
  "shared_expert",
  "tenant_customer",
  "user_private",
  "temporary_upload",
] as const;

export const contentScopeSchema = z.enum(CONTENT_SCOPES);
export type ContentScopeValue = z.infer<typeof contentScopeSchema>;

export const LANGUAGES = ["en", "vi"] as const;
export const languageSchema = z.enum(LANGUAGES);
export type LanguageValue = z.infer<typeof languageSchema>;

export const ingestionInputSchema = z.object({
  /** Source-of-truth URI for the raw document (GCS object or local path). Stable key
   *  for find-or-create: re-ingesting the same `sourceUri` adds a new version. */
  sourceUri: z.string().trim().min(1).max(1024),
  title: z.string().trim().min(1).max(300),
  scope: contentScopeSchema.default("global_expert"),
  language: languageSchema.default("en"),
  /** MIME type or file extension of the raw source; routes to a parser. */
  contentType: z.string().trim().min(1).max(150),
  /** Optional human note recorded on the immutable version. */
  changeSummary: z.string().trim().max(2000).optional(),
  /**
   * Optional expert attribution (Security Cycle 2). When set, the document becomes that expert's
   * own knowledge and is retrievable only under that expert's voice (plus the neutral voice);
   * omitted = the shared global corpus available to every voice. Set once at document creation.
   */
  expertId: z.string().uuid().optional(),
});

export type IngestionInput = z.infer<typeof ingestionInputSchema>;
