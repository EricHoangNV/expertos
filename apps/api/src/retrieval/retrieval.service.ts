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
import { RETRIEVAL_EMBEDDING_PROVIDER } from "./retrieval.tokens";

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
    const [embedding] = await this.embeddings.embed([query.text]);
    if (!embedding || embedding.length !== this.embeddings.dimensions) {
      throw new Error(
        `retrieval embedding has ${embedding?.length ?? 0} dims, expected ${this.embeddings.dimensions}`,
      );
    }

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
}
