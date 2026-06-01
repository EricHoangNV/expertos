import { z } from "zod";
import { languageSchema } from "./ingestion";
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
