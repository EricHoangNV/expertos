import { Inject, Injectable } from "@nestjs/common";
import {
  estimateTokens,
  type EmbeddingProvider,
  type RetrievalLanguage,
} from "@expertos/ai";
import type { VoiceQueryInput } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { UsageLogService } from "../observability/usage-log.service";
import { StructuredLogger } from "../observability/logger.service";
import { PgVoiceExampleStore } from "./voice-example.store";
import { VOICE_EMBEDDING_PROVIDER } from "./voice.tokens";
import type { RetrievedVoice } from "./voice.types";

/**
 * Runtime voice layer (M2.1). Given an expert + topic, it resolves the expert's published
 * voice profile for the requested language and retrieves the most similar expert-authored
 * voice examples — the "voice on top of facts" inputs the prompt builder layers onto the
 * separately-retrieved knowledge (PRD §"Expert voice layer"). This sits alongside, and is
 * deliberately separate from, {@link RetrievalService}: facts and voice are retrieved by
 * different seams so voice can never substitute for a fact.
 *
 * The query is embedded with the same model voice examples were embedded with, then the store
 * runs inside the acting user's RLS context so tenant isolation is enforced by Postgres
 * (directive §4.21). When the expert has no published profile in that language the result is
 * an empty voice layer — the caller falls back to a neutral voice, facts still enforced.
 */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(VOICE_EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    private readonly rls: RlsService,
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
  ) {}

  async retrieveVoice(
    user: AuthUser,
    query: VoiceQueryInput,
  ): Promise<RetrievedVoice> {
    const language = query.language as RetrievalLanguage;

    const [embedding] = await this.embeddings.embed([query.text]);
    if (!embedding || embedding.length !== this.embeddings.dimensions) {
      throw new Error(
        `voice embedding has ${embedding?.length ?? 0} dims, expected ${this.embeddings.dimensions}`,
      );
    }

    const result = await this.rls.run(user, async (tx) => {
      const store = new PgVoiceExampleStore(tx);
      const profile = await store.loadProfile(query.expertId, language);
      if (!profile) {
        return { profile: null, examples: [], language };
      }
      const examples = await store.retrieveExamples({
        voiceProfileId: profile.voiceProfileId,
        embedding,
        topK: query.topK,
      });
      return { profile, examples, language };
    });

    await this.usage.record(user, {
      featureKey: "voice.embed",
      model: this.embeddings.name,
      promptTokens: estimateTokens(query.text),
    });

    this.logger.info("voice retrieval completed", {
      expertId: query.expertId,
      language,
      profileFound: result.profile !== null,
      examples: result.examples.length,
    });

    return result;
  }
}
