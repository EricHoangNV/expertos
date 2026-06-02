import { z } from "zod";
import type { ConsultationRecommendationDto } from "./consultation";
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
  /**
   * Resolved citations for an assistant answer (M4.2), in marker order — empty for user messages
   * and for answers that cited nothing. Re-hydrated from the persisted citation rows so a history
   * view can render the same sources drawer the live turn showed; each carries its true marker
   * `ordinal` (the read path preserves it, so a non-contiguous list like a lone `[2]` is faithful).
   */
  citations: ChatCitationDto[];
  /**
   * Set on an assistant message that is a concierge **refined update** (M9.3): the id of the original
   * answer this reviewer-edited message refines. The history view shows the OD#5 visual indicator
   * ("This response includes AI-reviewed/edited content") for any message where this is present.
   * `null`/absent for an ordinary AI answer and for user messages.
   */
  refinedFromMessageId?: string | null;
  /**
   * True when the answer touched a high-stakes topic (financial / legal / medical / tax — NT.4). The
   * client renders the {@link HIGH_STAKES_DISCLAIMER} under any message where this is set, so the
   * disclaimer survives into the history read path (not just the live turn). Absent/false otherwise.
   */
  highStakes?: boolean;
}

/**
 * High-stakes-topic disclaimer (NT.4, PRD §"Non-Technical Requirements"), per UI locale (M13.4).
 *
 * This is legal system content, so — unlike the app-chrome strings, which live in each app's i18n
 * dictionary — every translation is single-sourced here next to the English. That keeps the wording
 * identical on the live chat and the history read path, lets the NT.4 legal sign-off review both
 * languages in one place, and ensures the localized copy can never drift from the system-prompt rule
 * that scopes the answer to educational context. The actionable "book a consultation" CTA is surfaced
 * separately by the M7 funnel (the topic trigger fires on high-stakes too).
 *
 * Both translations are DRAFTS awaiting the NT.4 PM/legal sign-off (the milestone's human gate).
 */
export const HIGH_STAKES_DISCLAIMERS: Record<LanguageValue, string> = {
  en: "This response is AI-generated for informational purposes only and does not constitute professional financial, legal, medical, or tax advice. For decisions with significant financial, legal, or health consequences, consider booking a consultation for guidance tailored to your situation.",
  vi: "Phản hồi này do AI tạo ra và chỉ nhằm mục đích cung cấp thông tin, không phải là tư vấn chuyên môn về tài chính, pháp lý, y tế hoặc thuế. Đối với các quyết định có hậu quả đáng kể về tài chính, pháp lý hoặc sức khỏe, hãy cân nhắc đặt lịch tư vấn để được hướng dẫn phù hợp với tình huống của bạn.",
};

/**
 * The English high-stakes disclaimer (NT.4). Retained as the canonical alias for the EN entry of
 * {@link HIGH_STAKES_DISCLAIMERS} so existing callers and the legal record keep a stable reference;
 * the localized rendering uses `HIGH_STAKES_DISCLAIMERS[locale]`.
 */
export const HIGH_STAKES_DISCLAIMER = HIGH_STAKES_DISCLAIMERS.en;

/**
 * A resolved citation for a finished answer. Aligns with the `@expertos/ai` prompt builder's
 * citation list (a `[n]` marker in the answer resolves to the citation with `ordinal === n`), so
 * the client can render a numbered source list once generation completes (Open Decision #7).
 */
export interface ChatCitationDto {
  /** 1-indexed marker number (the marker the model wrote — NOT renumbered, so it can be sparse). */
  ordinal: number;
  chunkId: string;
  documentVersionId: string;
  /** Source snippet for the sources drawer. */
  quote?: string;
  /**
   * Source class for the `.cite` colour treatment (M4.2 §"Design System"): published expert
   * knowledge renders crimson (`knowledge`), user uploads render info-blue (`upload`, M5). Derived
   * from which chunk the citation resolved to, so the drawer can colour-distinguish them.
   */
  kind: "knowledge" | "upload";
  /**
   * Human-readable provenance for an `upload` citation (M5.4): the uploaded file plus its
   * sheet/cell location (e.g. `budget.xlsx · Q1 KPIs!A2:B2`). The sources drawer shows this for
   * uploads in place of the `documentVersionId` it shows for knowledge. Absent for knowledge
   * citations (and on the history read path, where only `kind` is re-hydrated).
   */
  sourceLabel?: string;
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
      /**
       * True when no grounding sources were retrieved (M3.4): the answer is the
       * insufficient-knowledge response, so the client should surface a graceful next step
       * (e.g. rephrase, or book a consultation) instead of presenting it as a confident answer.
       */
      insufficientKnowledge: boolean;
      /**
       * True when the answer was served by the cheaper fair-use model (M6.3): the user has passed
       * their plan's fair-use soft threshold this window, so we degrade rather than block. The
       * client can surface a subtle "fair-use mode" note — never an error.
       */
      degraded?: boolean;
      /**
       * An in-chat consultation recommendation (M7.1): present only when an admin-configured rule
       * fired on this turn (topic / depth / low confidence / high intent), otherwise null. The
       * client renders a Book / Maybe later / Ask another prompt from it.
       */
      recommendation?: ConsultationRecommendationDto | null;
      /**
       * True when the question touched a high-stakes topic (financial / legal / medical / tax —
       * NT.4): the client surfaces the {@link HIGH_STAKES_DISCLAIMER} under the answer. The answer
       * itself was scoped to general educational context by the prompt builder.
       */
      highStakes?: boolean;
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

// ──────────────────────────── Answer feedback (M3.4) ────────────────────────────

/** A user's 👍/👎 verdict on an assistant answer (M3.4), with an optional free-text reason. */
export interface AnswerFeedbackDto {
  id: string;
  messageId: string;
  /** `true` = 👍 helpful, `false` = 👎 not helpful. */
  helpful: boolean;
  reason: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * Submit (or revise) feedback on an assistant answer (M3.4). Like bookmarking, only the
 * `messageId` is supplied — the owning conversation is derived server-side from the message and
 * ownership re-checked there (directive §26), so the client can't rate an answer in a conversation
 * it doesn't own. Re-submitting for the same answer replaces the prior verdict (a user can flip
 * 👍↔👎 or revise the reason), so the endpoint is an idempotent upsert keyed on `(user, message)`.
 */
export const answerFeedbackSubmitSchema = z.object({
  messageId: z.string().uuid(),
  helpful: z.boolean(),
  /** Optional reason; medium-text bounded + trimmed (directive §1.1). */
  reason: z.string().trim().max(500).optional(),
});

export type AnswerFeedbackSubmitInput = z.infer<typeof answerFeedbackSubmitSchema>;

// ──────────────────────────── Conversation search (M3.3) ────────────────────────────

/**
 * Full-text conversation search (M3.3, PRD §"History & retention"). `q` is the search text:
 * trimmed, length-bounded, then NFC-normalized at the boundary (directive §36 / Open Decision #9).
 * The Postgres keyword path searches with the `'simple'` text-search config, which does NOT
 * normalize, so a query typed in decomposed (NFD) form would silently miss against NFC-stored
 * Vietnamese content — exactly the M1.2 keyword-path rule. Tenant/user isolation is enforced by
 * Postgres RLS (directive §4.21), so no `tenant_id`/`user_id` appears here.
 */
export const conversationSearchQuerySchema = z.object({
  /** Search text. NFC-normalized (length-preserving, so it runs after `.max()` safely). */
  q: z.string().trim().min(1).max(200).transform(normalizeText),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ConversationSearchQueryInput = z.infer<typeof conversationSearchQuerySchema>;

/**
 * One hit in a conversation search (M3.3): the matching conversation plus a highlighted snippet
 * from its best-matching message. `snippet` is null when only the conversation title matched (no
 * message body hit), so the client can still surface the title as the reason for the match.
 *
 * The snippet wraps matched terms in guillemets (`«match»`) rather than HTML — the API never emits
 * markup, so a client that renders the excerpt as text is safe (directive §1); a client that wants
 * styled highlights must HTML-escape first, then replace the guillemet markers.
 */
export interface ConversationSearchResultDto {
  conversation: ConversationSummaryDto;
  /** A highlighted excerpt of the best-matching message, or null when only the title matched. */
  snippet: string | null;
  /** The matching message, or null when the match was on the conversation title alone. */
  messageId: string | null;
}
