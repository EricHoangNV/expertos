import { z } from "zod";
import {
  contentScopeSchema,
  languageSchema,
  type ContentScopeValue,
  type LanguageValue,
} from "./ingestion";
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

/**
 * Conversation-to-knowledge pipeline API contracts (M8.2, PRD §"Admin & Expert portals").
 *
 * An admin/expert marks a valuable conversation answer, capturing it as a `knowledge_drafts`
 * row that moves through its *own* review lifecycle —
 * `draft → expert_review → published` (with `request-changes` returning it to `draft`, and
 * `rejected` discarding it). Publishing is the gate: only an approved draft is ingested into
 * the knowledge base (M1.1 pipeline, `publish:true`) and becomes retrieval-visible. This
 * mirrors the M8.1 document publish gate but operates on free-text drafts captured from chat,
 * not uploaded files.
 */
export const KNOWLEDGE_DRAFT_STATUSES = [
  "draft",
  "expert_review",
  "published",
  "rejected",
] as const;
export const knowledgeDraftStatusSchema = z.enum(KNOWLEDGE_DRAFT_STATUSES);
export type KnowledgeDraftStatusValue = z.infer<typeof knowledgeDraftStatusSchema>;

/** "Mark valuable": capture a draft (optionally from a source conversation). */
export const knowledgeDraftCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(50_000),
  /** Source conversation this draft was promoted from (provenance), if any. */
  conversationId: z.string().uuid().optional(),
  language: languageSchema.default("en"),
});
export type KnowledgeDraftCreateInput = z.infer<typeof knowledgeDraftCreateSchema>;

/** Edit a draft's title/content (allowed only while it is still `draft`). */
export const knowledgeDraftUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    content: z.string().trim().min(1).max(50_000).optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "provide title and/or content to update",
  });
export type KnowledgeDraftUpdateInput = z.infer<typeof knowledgeDraftUpdateSchema>;

/** The review queue filter for drafts. */
export const knowledgeDraftListQuerySchema = z.object({
  status: knowledgeDraftStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type KnowledgeDraftListQueryInput = z.infer<typeof knowledgeDraftListQuerySchema>;

/** A draft in the review queue (no body content, for the list view). */
export interface KnowledgeDraftSummaryDto {
  id: string;
  title: string;
  status: KnowledgeDraftStatusValue;
  language: LanguageValue;
  /** Source conversation, if the draft was promoted from chat. */
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A draft with its full body content (detail / create / update / transition responses). */
export interface KnowledgeDraftDto extends KnowledgeDraftSummaryDto {
  content: string;
}
