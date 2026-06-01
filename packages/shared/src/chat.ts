import { z } from "zod";
import { languageSchema, type LanguageValue } from "./ingestion";
import { normalizeText } from "./text";

/**
 * Validated input for a chat turn (M3.1). One request = one user question, optionally inside an
 * existing conversation (`conversationId`) and optionally rendered in a chosen expert's voice
 * (`expertId`). The question `text` is trimmed, length-bounded, then NFC-normalized at the
 * boundary for the same reason knowledge/voice queries are (directive §36 / Open Decision #9):
 * the retrieval + voice embeddings are built over NFC text, so a decomposed query would silently
 * miss on Vietnamese. Tenant/user isolation is enforced by Postgres RLS (directive §4.21), so no
 * `tenant_id`/`user_id` appears here.
 */
export const chatRequestSchema = z.object({
  /** The user's question. NFC-normalized (length-preserving, so it runs after `.max()` safely). */
  text: z.string().trim().min(1).max(2000).transform(normalizeText),
  /** Continue an existing conversation; omitted = start a new one. */
  conversationId: z.string().uuid().optional(),
  /** Render the answer in this expert's voice; omitted = neutral voice (facts still enforced). */
  expertId: z.string().uuid().optional(),
  /** Answer language; also selects the voice profile + content language. Defaults to English. */
  language: languageSchema.default("en"),
  /** Max knowledge chunks to retrieve and ground on. */
  topK: z.number().int().min(1).max(50).default(8),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

/** A persisted chat message as returned to the client (history + live turns). */
export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * A resolved citation for a finished answer. Aligns with the `@expertos/ai` prompt builder's
 * citation list (a `[n]` marker in the answer resolves to the citation with `ordinal === n`), so
 * the client can render a numbered source list once generation completes (Open Decision #7).
 */
export interface ChatCitationDto {
  /** 1-indexed marker number. */
  ordinal: number;
  chunkId: string;
  documentVersionId: string;
  /** Source snippet for the sources drawer. */
  quote?: string;
}

/**
 * A single Server-Sent-Events frame from the streaming chat endpoint. Prose arrives as `delta`
 * frames during generation; the terminal `done` frame carries the persisted ids + the resolved
 * citations (rendered only after the stream completes — OD#7). An `error` frame ends a stream
 * that failed mid-generation.
 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      conversationId: string;
      messageId: string;
      citations: ChatCitationDto[];
      confidence?: number;
    }
  | { type: "error"; message: string };

// ──────────────────────────── Conversation history (M3.2) ────────────────────────────

/**
 * A conversation as it appears in the history list (M3.2). `title` is auto-derived from the first
 * question at creation, or a user-chosen rename; it is null only for a conversation created before
 * auto-titling existed. The list is ordered by `updatedAt` (most recent activity first).
 */
export interface ConversationSummaryDto {
  id: string;
  title: string | null;
  /** Expert whose voice the conversation was started in, if any. */
  expertId: string | null;
  language: LanguageValue;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last turn — the history sort key. */
  updatedAt: string;
}

/** A conversation plus its full user/assistant transcript (the M3.2 history detail view). */
export interface ConversationDetailDto extends ConversationSummaryDto {
  messages: ChatMessageDto[];
}

/** Pagination for the conversation history list. */
export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ConversationListQueryInput = z.infer<typeof conversationListQuerySchema>;

/**
 * Rename a conversation, overriding the auto-derived title (M3.2). Length-bounded as short text
 * (directive §1.1); trimmed so a whitespace-only title can't slip through.
 */
export const conversationRenameSchema = z.object({
  title: z.string().trim().min(1).max(100),
});

export type ConversationRenameInput = z.infer<typeof conversationRenameSchema>;

// ──────────────────────────── Saved answers / bookmarks (M3.2) ────────────────────────────

/** A bookmarked assistant answer (M3.2), with an optional user note. */
export interface SavedAnswerDto {
  id: string;
  conversationId: string;
  messageId: string;
  note: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * Bookmark an assistant answer (M3.2). Only the `messageId` is supplied — the owning conversation
 * is derived server-side from the message and ownership re-checked there (directive §26), so the
 * client can't bookmark an answer in a conversation it doesn't own.
 */
export const savedAnswerCreateSchema = z.object({
  messageId: z.string().uuid(),
  /** Optional note; medium-text bounded (directive §1.1). */
  note: z.string().trim().max(500).optional(),
});

export type SavedAnswerCreateInput = z.infer<typeof savedAnswerCreateSchema>;

/** Pagination for the saved-answers list. */
export const savedAnswerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SavedAnswerListQueryInput = z.infer<typeof savedAnswerListQuerySchema>;
