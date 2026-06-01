import { Inject, Injectable } from "@nestjs/common";
import {
  chunkText,
  type EmbeddingProvider,
  type Summarizer,
} from "@expertos/ai";
import { ingestionInputSchema } from "@expertos/shared";
import type { AuthUser } from "../auth/auth.types";
import { UsageLogService } from "../observability/usage-log.service";
import { StructuredLogger } from "../observability/logger.service";
import { ParserRegistry } from "./parser-registry";
import {
  DocumentVersionRepository,
  type StoredVersion,
} from "./document-version.repository";
import {
  EMBEDDING_PROVIDER,
  PARSER_REGISTRY,
  SUMMARIZER,
} from "./ingestion.tokens";

/** Thrown when a source parses to no chunkable text — nothing to ingest. */
export class EmptyDocumentError extends Error {
  constructor(public readonly sourceUri: string) {
    super(`Document parsed to empty content: ${sourceUri}`);
    this.name = "EmptyDocumentError";
  }
}

interface IngestOptions {
  /** Publish on ingest (default; seed/CLI load) or leave a draft for the M8 review gate. */
  publish?: boolean;
}

/**
 * Orchestrates the M1.1 ingestion pipeline: validate → parse → chunk → summarize →
 * embed → store as an immutable document version. Each stage sits behind a contract
 * ({@link ParserRegistry}, {@link Summarizer}, {@link EmbeddingProvider},
 * {@link DocumentVersionRepository}) so drivers swap without touching this flow.
 *
 * Embedding cost is recorded via {@link UsageLogService} (best-effort) for Open
 * Decision #4 unit-economics analysis. The {@link RlsService} scoping happens inside the
 * repository so the persistence step is the single DB choke point.
 */
@Injectable()
export class IngestionService {
  constructor(
    @Inject(PARSER_REGISTRY) private readonly registry: ParserRegistry,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(SUMMARIZER) private readonly summarizer: Summarizer,
    private readonly repository: DocumentVersionRepository,
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
  ) {}

  async ingest(
    user: AuthUser,
    rawInput: unknown,
    raw: Buffer | string,
    options: IngestOptions = {},
  ): Promise<StoredVersion> {
    const input = ingestionInputSchema.parse(rawInput);
    const publish = options.publish ?? true;

    const parser = this.registry.resolve(input.contentType);
    const parsed = await parser.parse(raw);

    const textChunks = chunkText(parsed.text);
    if (textChunks.length === 0) {
      throw new EmptyDocumentError(input.sourceUri);
    }

    const contents = textChunks.map((chunk) => chunk.content);
    const [summaries, embeddings] = await Promise.all([
      Promise.all(contents.map((content) => this.summarizer.summarize(content))),
      this.embeddings.embed(contents),
    ]);

    // The EmbeddingProvider contract guarantees one vector per input, in order — assert
    // it so a misbehaving driver can't silently misalign a vector with the wrong chunk.
    if (embeddings.length !== contents.length) {
      throw new Error(
        `embedding provider returned ${embeddings.length} vectors for ${contents.length} chunks`,
      );
    }

    const chunks = textChunks.map((chunk, i) => ({
      index: chunk.index,
      content: chunk.content,
      summary: summaries[i],
      tokenCount: chunk.tokenCount,
      embedding: embeddings[i],
    }));

    const stored = await this.repository.store(user, {
      input,
      chunks,
      embeddingDimensions: this.embeddings.dimensions,
      publish,
    });

    const totalTokens = textChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    await this.usage.record(user, {
      featureKey: "ingest.embed",
      model: this.embeddings.name,
      promptTokens: totalTokens,
    });

    this.logger.info("Ingested document version", {
      sourceUri: input.sourceUri,
      documentId: stored.documentId,
      documentVersionId: stored.documentVersionId,
      versionNumber: stored.versionNumber,
      chunkCount: stored.chunkCount,
      published: stored.published,
    });

    return stored;
  }
}
