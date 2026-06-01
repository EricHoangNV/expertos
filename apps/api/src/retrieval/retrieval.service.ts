import { Inject, Injectable } from "@nestjs/common";
import {
  estimateTokens,
  type EmbeddingProvider,
  type RetrievalRequest,
  type RetrievedChunk,
} from "@expertos/ai";
import type { RetrievalQueryInput } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { UsageLogService } from "../observability/usage-log.service";
import { StructuredLogger } from "../observability/logger.service";
import { PgVectorStore } from "./pgvector.store";
import {
  PgUploadChunkStore,
  type RetrievedUploadChunk,
} from "./upload-chunk.store";
import { RETRIEVAL_EMBEDDING_PROVIDER } from "./retrieval.tokens";

/** Parameters for folding a user's own uploads into a chat turn (M5.4). */
interface UploadRetrievalInput {
  /** Query text — embedded with the same model as knowledge retrieval. */
  text: string;
  /** Max upload chunks to fold in. */
  topK: number;
  /** Current conversation, to include its `temporary` uploads; absent = `persistent` only. */
  conversationId?: string;
}

/**
 * Entry point for M1.2 hybrid retrieval and the seam the chat layer (M3) and citation
 * builder (M4) will call. It embeds the query text with the same model the ingestion
 * pipeline used, then runs the {@link PgVectorStore} inside the acting user's RLS context
 * so tenant isolation is enforced by Postgres (directive §4.21) — the single DB choke
 * point for retrieval.
 *
 * The shared {@link RetrievalQueryInput} (already validated/sanitized at the API boundary)
 * carries the metadata filters; assigning its `filters` into the `@expertos/ai`
 * {@link RetrievalRequest} is the compile-time guard that the two filter vocabularies
 * never drift.
 */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(RETRIEVAL_EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    private readonly rls: RlsService,
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
  ) {}

  async retrieve(
    user: AuthUser,
    query: RetrievalQueryInput,
  ): Promise<RetrievedChunk[]> {
    const embedding = await this.embedQuery(query.text);

    const request: RetrievalRequest = {
      text: query.text,
      embedding,
      topK: query.topK,
      filters: query.filters,
    };

    const results = await this.rls.run(user, (tx) =>
      new PgVectorStore(tx).retrieve(request),
    );

    await this.usage.record(user, {
      featureKey: "retrieve.embed",
      model: this.embeddings.name,
      promptTokens: estimateTokens(query.text),
    });

    this.logger.info("hybrid retrieval completed", {
      topK: query.topK,
      results: results.length,
      status: query.filters.status,
      language: query.filters.language ?? "any",
    });

    return results;
  }

  /**
   * Folds the acting user's own query-time uploads (M5.4) into retrieval, ranked against the same
   * query embedding as knowledge retrieval. `persistent` uploads are always in scope; `temporary`
   * uploads only when they belong to the current conversation. Isolation is RLS — `uploaded_files`
   * is `user_scoped`, so the store's JOIN limits chunks to the user's own files (directive §4.21).
   *
   * This embeds the query independently of {@link retrieve} so each retrieval seam stays a single
   * responsibility; the extra embed of one short question is negligible (a shared-vector
   * optimization can land later if a real provider makes it worthwhile).
   */
  async retrieveUploads(
    user: AuthUser,
    query: UploadRetrievalInput,
  ): Promise<RetrievedUploadChunk[]> {
    const embedding = await this.embedQuery(query.text);

    const results = await this.rls.run(user, (tx) =>
      new PgUploadChunkStore(tx).retrieve({
        embedding,
        topK: query.topK,
        conversationId: query.conversationId,
      }),
    );

    await this.usage.record(user, {
      featureKey: "upload.retrieve.embed",
      model: this.embeddings.name,
      promptTokens: estimateTokens(query.text),
    });

    this.logger.info("upload retrieval completed", {
      topK: query.topK,
      results: results.length,
      conversationScoped: query.conversationId != null,
    });

    return results;
  }

  /** Embeds query text and asserts the provider returned a single vector of the expected width. */
  private async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embeddings.embed([text]);
    if (!embedding || embedding.length !== this.embeddings.dimensions) {
      throw new Error(
        `retrieval embedding has ${embedding?.length ?? 0} dims, expected ${this.embeddings.dimensions}`,
      );
    }
    return embedding;
  }
}
