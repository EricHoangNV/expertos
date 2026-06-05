import { Inject, Injectable } from "@nestjs/common";
import {
  buildAnswerPrompt,
  buildCitations,
  detectHighStakes,
  type ChatMessage,
  type LlmCallOptions,
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
import { RecommendationService } from "../consultation/recommendation.service";
import { ConciergeQueueService } from "../concierge/concierge-queue.service";
import { SettingsService } from "../settings/settings.service";
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
    private readonly recommendation: RecommendationService,
    private readonly concierge: ConciergeQueueService,
    private readonly settings: SettingsService,
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

    // M17.3 runtime answer tuning: the standard tier reads the admin-tunable temperature + default
    // model from the 30s-TTL settings snapshot and threads them into the single LLM call below.
    // The degraded/fair-use tier (M6.3) is deliberately left untouched — it stays on its own cheap
    // provider/model with no override. `effectiveModel` is the model actually called (the override
    // for the standard tier, else the provider's own name); it — not `llm.name` — is the identity
    // used for the answer-cache key, persisted turn, and usage/cost log so each matches what ran.
    let callOptions: LlmCallOptions | undefined;
    if (!degraded) {
      const tuning = await this.settings.getCached();
      callOptions = { temperature: tuning.llmTemperature, model: tuning.defaultChatModel };
    }
    const effectiveModel = callOptions?.model ?? llm.name;

    // High-stakes detection (NT.4) is a pure function of the (NFC-normalized) question, so it is
    // computed once up front and reused across the fresh and cached paths: it scopes the prompt to
    // educational context, flags the persisted answer + usage log, drives the disclaimer on the
    // client, and feeds the consultation funnel's `topic` trigger.
    const highStakes = detectHighStakes(input.text) !== null;
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
            model: effectiveModel,
          })
        : null;
      if (answerKey) {
        const hit = await this.cache.lookupAnswer(user, answerKey, effectiveModel);
        if (hit) {
          yield* this.serveCachedAnswer(user, input, hit, degraded, highStakes);
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
        highStakes,
      });

      // Layer prior turns between the system message and the freshly built user message so the
      // builder stays pure (voice-on-facts enforced) and context is added only at the app seam.
      const [system, userMessage] = prompt.messages;
      const messages: ChatMessage[] = [system, ...history, userMessage];

      let answer = "";
      let usage = { promptTokens: 0, completionTokens: 0 };
      if (llm.completeStream) {
        for await (const chunk of llm.completeStream(messages, callOptions)) {
          if (chunk.delta) {
            answer += chunk.delta;
            yield { type: "delta", text: chunk.delta };
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      } else {
        const completion = await llm.complete(messages, callOptions);
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

      // The product-level trust signal is whether the *final* answer carries a resolved citation —
      // not whether retrieval found facts (Product Cycle 1 fix). A fluent model reply that cites
      // nothing (cited only forged/unresolvable markers that `buildCitations` stripped, or answered
      // from nearby context without attaching any marker) is ungrounded: it must surface the honest
      // insufficient-knowledge state, trigger concierge review + consultation routing, and stay
      // uncached — exactly like a zero-facts refusal. We cannot rely on model obedience for the trust
      // contract now that real LLM drivers sit behind the seam. `built.citations.length` counts both
      // knowledge and upload citations, so a genuinely upload-grounded answer stays grounded.
      const ungrounded = built.citations.length === 0;

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
          model: effectiveModel,
          confidence: null,
          highStakes,
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
        model: effectiveModel,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        conversationId: persisted.conversationId,
        highStakes,
      });

      // Populate the answer + persistent semantic cache, but only for a grounded answer (≥1
      // citation): an uncited or insufficient-knowledge answer must not be pinned (knowledge could
      // be published later, and a cached "I don't know" would then be wrong until it ages out).
      if (answerKey && built.citations.length > 0) {
        await this.cache.storeAnswer(user, answerKey, {
          text: built.text,
          model: effectiveModel,
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
        model: effectiveModel,
      });

      // M9.2 concierge: when Mode B (auto-silent) is enabled and the answer is low-confidence, quietly
      // queue it for human review behind the scenes (the user still sees this normal answer). Non-fatal
      // by design — the service swallows its own errors so a queueing hiccup can't break the answer.
      await this.concierge.enqueueIfTriggered(user, {
        messageId: persisted.messageId,
        conversationId: persisted.conversationId,
        insufficientKnowledge: ungrounded,
        confidence: null,
      });

      // M7.1 consultation funnel: evaluate the admin-configured rules against this turn and, if one
      // fires, surface an in-chat "book a consultation" prompt on the terminal event. Non-fatal by
      // design — the service degrades to null rather than break an answer that has already streamed.
      const recommendation = await this.recommendation.recommend(user, {
        conversationId: persisted.conversationId,
        question: input.text,
        answer: built.text,
        citationCount: built.citations.length,
        insufficientKnowledge: ungrounded,
        highStakes,
      });

      yield {
        type: "done",
        conversationId: persisted.conversationId,
        messageId: persisted.messageId,
        citations: built.citations.map(toCitationDto),
        // No resolved citation on the final answer → ungrounded (M3.4 + Product Cycle 1). Surface the
        // honest insufficient-knowledge state to the client so it offers a graceful next step rather
        // than presenting an uncited reply as a confident, verifiable answer.
        insufficientKnowledge: ungrounded,
        degraded,
        recommendation,
        highStakes,
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
    highStakes: boolean,
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
        highStakes,
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
      highStakes,
    });

    this.logger.info("chat answer served from cache", {
      conversationId: persisted.conversationId,
      sources: hit.citations.length,
      degraded,
    });

    // A cached answer is a real turn in this user's history, so it gets the same M7.1 funnel
    // evaluation (a cacheable answer is grounded + first-turn, so topic/high-intent can still fire).
    const recommendation = await this.recommendation.recommend(user, {
      conversationId: persisted.conversationId,
      question: input.text,
      answer: hit.text,
      citationCount: hit.citations.length,
      insufficientKnowledge: false,
      highStakes,
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
      recommendation,
      highStakes,
    };
  }

  private toRetrievalQuery(input: ChatRequestInput): RetrievalQueryInput {
    // No `language` filter: cross-lingual retrieval is the resolved OD#9 default, so a Vietnamese
    // question can still ground on English knowledge. `status: published` keeps answers grounded
    // in expert-reviewed knowledge only. `expertId` enforces the expert-knowledge boundary
    // (Security Cycle 2): a selected expert voice grounds only on that expert's own knowledge +
    // the unattributed global corpus, never another expert's. Omitted (neutral) = no restriction.
    return {
      text: input.text,
      topK: input.topK,
      filters: { status: "published", ...(input.expertId ? { expertId: input.expertId } : {}) },
    };
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
