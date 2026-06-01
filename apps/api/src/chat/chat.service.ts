import { Inject, Injectable } from "@nestjs/common";
import {
  buildAnswerPrompt,
  buildCitations,
  type ChatMessage,
  type LlmProvider,
  type PromptFact,
  type ResolvedCitation,
} from "@expertos/ai";
import type {
  ChatCitationDto,
  ChatRequestInput,
  ChatStreamEvent,
  RetrievalQueryInput,
} from "@expertos/shared";
import type { AuthUser } from "../auth/auth.types";
import { RetrievalService } from "../retrieval/retrieval.service";
import type { RetrievedUploadChunk } from "../retrieval/upload-chunk.store";
import { VoiceService } from "../voice/voice.service";
import { UsageLogService } from "../observability/usage-log.service";
import { StructuredLogger } from "../observability/logger.service";
import { ResponseCacheService } from "../cache/response-cache.service";
import type { CachedAnswer } from "../cache/cache.types";
import { CHAT_DEGRADED_LLM_PROVIDER, CHAT_LLM_PROVIDER } from "./chat.tokens";
import { ConversationService } from "./conversation.service";

/** Max characters of a source surfaced to the client as a citation preview. */
const CITATION_PREVIEW_CHARS = 280;

/** Voice examples retrieved per answer — small so the few-shot block can't crowd out facts. */
const VOICE_EXAMPLE_TOPK = 3;

/** Max of the user's own uploaded chunks folded into one answer (M5.4), kept modest vs. knowledge. */
const UPLOAD_FACT_TOPK = 5;

/**
 * The chat orchestration seam (M3.1) — the first consumer that wires the M1 retrieval and M2
 * voice layers through the `@expertos/ai` prompt builder into a generated, streamed, persisted
 * answer. For one turn it: (1) replays prior context, (2) retrieves grounding facts, (3) layers
 * the chosen expert's voice on top (or stays neutral), (4) builds the voice-on-facts prompt,
 * (5) streams the completion to the caller, and (6) — only after generation completes — persists
 * the turn and emits the resolved citations (Open Decision #7: a citation never appears then
 * vanishes). Facts and voice are retrieved by separate seams so voice can never substitute for a
 * fact; the prompt builder is the single enforcement point for that contract.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly voice: VoiceService,
    private readonly conversations: ConversationService,
    @Inject(CHAT_LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(CHAT_DEGRADED_LLM_PROVIDER) private readonly degradedLlm: LlmProvider,
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
    private readonly cache: ResponseCacheService,
  ) {}

  /**
   * Answers one turn, streaming the prose as it generates and ending with a single terminal
   * event carrying the persisted ids + resolved citations. Any failure ends the stream with an
   * `error` event rather than a half-written turn.
   *
   * `options.degraded` (set from the entitlement gate's fair-use decision, M6.3) serves the answer
   * with the cheaper {@link CHAT_DEGRADED_LLM_PROVIDER} instead of blocking — the only behavioural
   * fork; retrieval, voice, prompt, citation, and persistence are identical across tiers.
   */
  async *answerStream(
    user: AuthUser,
    input: ChatRequestInput,
    options?: { degraded?: boolean },
  ): AsyncGenerator<ChatStreamEvent> {
    const degraded = options?.degraded ?? false;
    const llm = degraded ? this.degradedLlm : this.llm;
    try {
      const history = input.conversationId
        ? await this.conversations.loadHistory(user, input.conversationId)
        : [];

      // Fold the asker's own query-time uploads (M5.4) in after knowledge, so knowledge keeps the
      // low marker numbers [1..N] and uploads follow [N+1..]. An upload fact carries no
      // knowledge provenance (empty chunkId/documentVersionId) — its provenance is `uploadChunkId`.
      // Retrieved up front because they also decide cacheability (below).
      const uploads = await this.retrieval.retrieveUploads(user, {
        text: input.text,
        topK: UPLOAD_FACT_TOPK,
        conversationId: input.conversationId,
      });

      // Answer cache (M6.4): only a *standalone, knowledge-only* turn is cacheable — its answer is
      // a pure function of (question, scope, voice, language, model tier), shared across the tenant.
      // A turn with prior context (history) or the user's private uploads is user-specific, so it is
      // never served from / written to the shared cache. The model tier is in the key (M6.3), so a
      // degraded answer never serves a standard-tier user. Quota was already reserved by the
      // entitlement guard before this handler ran, so a cache hit neither double-counts nor refunds.
      const cacheable = history.length === 0 && uploads.length === 0;
      const answerKey = cacheable
        ? this.cache.answerKey(user.tenantId, {
            text: input.text,
            topK: input.topK,
            expertId: input.expertId,
            language: input.language,
            model: llm.name,
          })
        : null;
      if (answerKey) {
        const hit = await this.cache.lookupAnswer(user, answerKey, llm.name);
        if (hit) {
          yield* this.serveCachedAnswer(user, input, hit, degraded);
          return;
        }
      }

      const chunks = await this.retrieval.retrieve(user, this.toRetrievalQuery(input));
      const facts: PromptFact[] = [
        ...chunks.map((c) => ({
          chunkId: c.chunkId,
          documentVersionId: c.documentVersionId,
          content: c.content,
        })),
        ...uploads.map((u) => ({
          chunkId: "",
          documentVersionId: "",
          content: u.content,
          kind: "upload" as const,
          uploadChunkId: u.uploadChunkId,
          sourceLabel: uploadSourceLabel(u),
        })),
      ];

      const voice = await this.resolveVoice(user, input);
      const prompt = buildAnswerPrompt({
        query: input.text,
        facts,
        voice: voice?.profile
          ? { expertName: voice.profile.expertName, guidelines: voice.profile.guidelines }
          : undefined,
        voiceExamples: voice?.examples.map((e) => ({ prompt: e.prompt, content: e.content })),
        language: input.language,
      });

      // Layer prior turns between the system message and the freshly built user message so the
      // builder stays pure (voice-on-facts enforced) and context is added only at the app seam.
      const [system, userMessage] = prompt.messages;
      const messages: ChatMessage[] = [system, ...history, userMessage];

      let answer = "";
      let usage = { promptTokens: 0, completionTokens: 0 };
      if (llm.completeStream) {
        for await (const chunk of llm.completeStream(messages)) {
          if (chunk.delta) {
            answer += chunk.delta;
            yield { type: "delta", text: chunk.delta };
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      } else {
        const completion = await llm.complete(messages);
        answer = completion.text;
        usage = completion.usage;
        yield { type: "delta", text: answer };
      }

      // Enforce the M4.1 chunk-resolvability guarantee: keep only the sources the answer actually
      // cited with a resolvable marker, and strip any unresolvable marker from the persisted text.
      // `prompt.citations` is the ordered resolution table (marker [i+1] → citations[i]).
      const built = buildCitations({ answer, citations: prompt.citations });
      if (built.citations.length < facts.length) {
        this.logger.info("chat citations filtered", {
          retrieved: facts.length,
          cited: built.citations.length,
        });
      }

      // Provenance is the document_version ids of the *knowledge* sources cited; upload citations
      // carry no document version (empty), so they're filtered out here.
      const sourceVersionIds = [
        ...new Set(built.citations.map((c) => c.documentVersionId).filter((id) => id.length > 0)),
      ];
      const persisted = await this.conversations.persistTurn(user, {
        conversationId: input.conversationId,
        expertId: input.expertId,
        language: input.language,
        userText: input.text,
        assistant: {
          content: built.text,
          sourceVersionIds,
          model: llm.name,
          confidence: null,
          citations: built.citations.map((c) => ({
            ordinal: c.ordinal,
            chunkId: c.chunkId,
            documentVersionId: c.documentVersionId,
            uploadChunkId: c.uploadChunkId,
            content: c.content,
          })),
        },
      });

      await this.usage.record(user, {
        featureKey: "chat.answer",
        model: llm.name,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        conversationId: persisted.conversationId,
      });

      // Populate the answer + persistent semantic cache, but only for a grounded answer (≥1
      // citation): an uncited or insufficient-knowledge answer must not be pinned (knowledge could
      // be published later, and a cached "I don't know" would then be wrong until it ages out).
      if (answerKey && built.citations.length > 0) {
        await this.cache.storeAnswer(user, answerKey, {
          text: built.text,
          model: llm.name,
          sourceVersionIds,
          citations: built.citations.map((c) => ({
            ordinal: c.ordinal,
            chunkId: c.chunkId,
            documentVersionId: c.documentVersionId,
            content: c.content,
          })),
        });
      }

      this.logger.info("chat answer completed", {
        conversationId: persisted.conversationId,
        expertId: input.expertId ?? "none",
        sources: facts.length,
        voiced: voice?.profile != null,
        degraded,
      });

      yield {
        type: "done",
        conversationId: persisted.conversationId,
        messageId: persisted.messageId,
        citations: built.citations.map(toCitationDto),
        // No grounding sources → the prompt builder's INSUFFICIENT-KNOWLEDGE rule governed the
        // answer (M3.4). Surface that to the client so it can offer a graceful next step rather
        // than present an ungrounded reply as a confident answer.
        insufficientKnowledge: facts.length === 0,
        degraded,
      };
    } catch (error) {
      this.logger.error("chat answer failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      yield { type: "error", message: "Failed to generate an answer." };
    }
  }

  /**
   * Serves a cached answer (M6.4): streams the prose as a single delta, persists the turn into the
   * caller's conversation (a cache hit is still a real turn in *this* user's history), records the
   * turn at zero model cost (the LLM call was skipped — the margin win), and emits the same terminal
   * `done` event a freshly generated grounded answer would. Cacheable answers are knowledge-only, so
   * every citation is a knowledge citation and `insufficientKnowledge` is always false.
   */
  private async *serveCachedAnswer(
    user: AuthUser,
    input: ChatRequestInput,
    hit: CachedAnswer,
    degraded: boolean,
  ): AsyncGenerator<ChatStreamEvent> {
    yield { type: "delta", text: hit.text };

    const persisted = await this.conversations.persistTurn(user, {
      conversationId: input.conversationId,
      expertId: input.expertId,
      language: input.language,
      userText: input.text,
      assistant: {
        content: hit.text,
        sourceVersionIds: hit.sourceVersionIds,
        model: hit.model,
        confidence: null,
        citations: hit.citations.map((c) => ({
          ordinal: c.ordinal,
          chunkId: c.chunkId,
          documentVersionId: c.documentVersionId,
          content: c.content,
        })),
      },
    });

    await this.usage.record(user, {
      featureKey: "chat.answer",
      model: hit.model,
      promptTokens: 0,
      completionTokens: 0,
      conversationId: persisted.conversationId,
    });

    this.logger.info("chat answer served from cache", {
      conversationId: persisted.conversationId,
      sources: hit.citations.length,
      degraded,
    });

    yield {
      type: "done",
      conversationId: persisted.conversationId,
      messageId: persisted.messageId,
      citations: hit.citations.map((c) => ({
        ordinal: c.ordinal,
        chunkId: c.chunkId,
        documentVersionId: c.documentVersionId,
        quote: c.content.slice(0, CITATION_PREVIEW_CHARS),
        kind: "knowledge" as const,
      })),
      insufficientKnowledge: false,
      degraded,
    };
  }

  private toRetrievalQuery(input: ChatRequestInput): RetrievalQueryInput {
    // No `language` filter: cross-lingual retrieval is the resolved OD#9 default, so a Vietnamese
    // question can still ground on English knowledge. `status: published` keeps answers grounded
    // in expert-reviewed knowledge only.
    return { text: input.text, topK: input.topK, filters: { status: "published" } };
  }

  private async resolveVoice(user: AuthUser, input: ChatRequestInput) {
    if (!input.expertId) {
      return null;
    }
    return this.voice.retrieveVoice(user, {
      expertId: input.expertId,
      text: input.text,
      language: input.language,
      topK: VOICE_EXAMPLE_TOPK,
    });
  }
}

function toCitationDto(citation: ResolvedCitation): ChatCitationDto {
  return {
    ordinal: citation.ordinal,
    chunkId: citation.chunkId,
    documentVersionId: citation.documentVersionId,
    quote: citation.content.slice(0, CITATION_PREVIEW_CHARS),
    kind: citation.kind,
    sourceLabel: citation.sourceLabel,
  };
}

/**
 * Builds an upload citation's provenance label (M5.4): the filename plus, for a spreadsheet chunk,
 * its sheet/cell location (`budget.xlsx · Q1 KPIs!A2:B2`, `notes.csv · A5`). Prose uploads (PDF/
 * DOCX) carry no sheet/cell, so the label is just the filename.
 */
function uploadSourceLabel(upload: RetrievedUploadChunk): string {
  const location =
    upload.sheetName && upload.cellRef
      ? `${upload.sheetName}!${upload.cellRef}`
      : (upload.cellRef ?? upload.sheetName ?? null);
  return location ? `${upload.filename} · ${location}` : upload.filename;
}
