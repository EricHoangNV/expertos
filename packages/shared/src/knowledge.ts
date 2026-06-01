import { z } from "zod";
import { contentScopeSchema, type ContentScopeValue, type LanguageValue } from "./ingestion";
import { publishStatusSchema, type PublishStatusValue } from "./publish";

/**
 * Admin/expert knowledge-publishing API contracts (M8.1, PRD §"Admin & Expert portals").
 *
 * A document version moves through the shared publish lifecycle —
 * `draft → expert_review → published` (with `request-changes` returning it to `draft`,
 * and `archived` retiring a live version). Publishing is the *expert-review gate*: only an
 * approved version becomes retrieval-visible, and approving a new version supersedes (archives)
 * the document's prior published version so retrieval never returns two generations at once.
 */
export const knowledgeListQuerySchema = z.object({
  /** Narrow to documents whose own publish status matches (e.g. the `expert_review` queue). */
  status: publishStatusSchema.optional(),
  scope: contentScopeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type KnowledgeListQueryInput = z.infer<typeof knowledgeListQuerySchema>;

/** One immutable version in a document's history, with its current lifecycle status. */
export interface KnowledgeVersionDto {
  id: string;
  documentId: string;
  versionNumber: number;
  status: PublishStatusValue;
  changeSummary: string | null;
  chunkCount: number;
  /** UUID of the approving expert/admin (stamped on publish), else null. */
  approvedBy: string | null;
  /** ISO timestamp of approval, else null. */
  approvedAt: string | null;
  createdAt: string;
  /** True when this is the document's currently-published (retrieval-visible) version. */
  isPublished: boolean;
}

/** A knowledge document with a snapshot of its versions for the review queue. */
export interface KnowledgeDocumentDto {
  id: string;
  title: string;
  scope: ContentScopeValue;
  language: LanguageValue;
  status: PublishStatusValue;
  publishedVersionId: string | null;
  versionCount: number;
  /** Highest-numbered version (the one a reviewer acts on), or null when none exist yet. */
  latestVersion: KnowledgeVersionDto | null;
  updatedAt: string;
}

/** Full document detail: every version, newest first, for the version-history view. */
export interface KnowledgeDocumentDetailDto extends KnowledgeDocumentDto {
  versions: KnowledgeVersionDto[];
}
