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
import { VoiceService } from "../voice/voice.service";
import { UsageLogService } from "../observability/usage-log.service";
import { StructuredLogger } from "../observability/logger.service";
import { CHAT_LLM_PROVIDER } from "./chat.tokens";
import { ConversationService } from "./conversation.service";

/** Max characters of a source surfaced to the client as a citation preview. */
const CITATION_PREVIEW_CHARS = 280;

/** Voice examples retrieved per answer — small so the few-shot block can't crowd out facts. */
const VOICE_EXAMPLE_TOPK = 3;

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
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Answers one turn, streaming the prose as it generates and ending with a single terminal
   * event carrying the persisted ids + resolved citations. Any failure ends the stream with an
   * `error` event rather than a half-written turn.
   */
  async *answerStream(
    user: AuthUser,
    input: ChatRequestInput,
  ): AsyncGenerator<ChatStreamEvent> {
    try {
      const history = input.conversationId
        ? await this.conversations.loadHistory(user, input.conversationId)
        : [];

      const chunks = await this.retrieval.retrieve(user, this.toRetrievalQuery(input));
      const facts: PromptFact[] = chunks.map((c) => ({
        chunkId: c.chunkId,
        documentVersionId: c.documentVersionId,
        content: c.content,
      }));

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
      if (this.llm.completeStream) {
        for await (const chunk of this.llm.completeStream(messages)) {
          if (chunk.delta) {
            answer += chunk.delta;
            yield { type: "delta", text: chunk.delta };
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      } else {
        const completion = await this.llm.complete(messages);
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

      const sourceVersionIds = [...new Set(built.citations.map((c) => c.documentVersionId))];
      const persisted = await this.conversations.persistTurn(user, {
        conversationId: input.conversationId,
        expertId: input.expertId,
        language: input.language,
        userText: input.text,
        assistant: {
          content: built.text,
          sourceVersionIds,
          model: this.llm.name,
          confidence: null,
          citations: built.citations.map((c) => ({
            chunkId: c.chunkId,
            documentVersionId: c.documentVersionId,
            content: c.content,
          })),
        },
      });

      await this.usage.record(user, {
        featureKey: "chat.answer",
        model: this.llm.name,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        conversationId: persisted.conversationId,
      });

      this.logger.info("chat answer completed", {
        conversationId: persisted.conversationId,
        expertId: input.expertId ?? "none",
        sources: facts.length,
        voiced: voice?.profile != null,
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
      };
    } catch (error) {
      this.logger.error("chat answer failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      yield { type: "error", message: "Failed to generate an answer." };
    }
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
  };
}
