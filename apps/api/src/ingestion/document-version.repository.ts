import { Injectable } from "@nestjs/common";
import type { IngestionInput } from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { toVectorLiteral } from "../database/vector";

/** A fully-processed chunk ready to persist (text + summary + embedding). */
interface ChunkToStore {
  index: number;
  content: string;
  summary: string;
  tokenCount: number;
  embedding: number[];
}

export interface StoreVersionParams {
  input: IngestionInput;
  chunks: ChunkToStore[];
  /** Expected embedding dimensionality — every chunk vector must match (defense). */
  embeddingDimensions: number;
  /** Publish immediately (seed/CLI load) vs leave as a draft for the M8 review gate. */
  publish: boolean;
}

export interface StoredVersion {
  documentId: string;
  documentVersionId: string;
  versionNumber: number;
  chunkCount: number;
  published: boolean;
}

/**
 * Persists one immutable {@link DocumentVersion} with its chunks, versioned per source
 * (PRD §"Data Model"). Re-ingesting the same `(tenant, scope, sourceUri)` appends a new
 * version rather than mutating the prior one — the snapshot history is preserved for
 * citation provenance.
 *
 * All writes run inside {@link RlsService} so the rows are tenant-scoped by Postgres RLS.
 * The embedding (`vector(1536)`) is written via raw SQL because Prisma can't map the
 * `Unsupported("vector")` column.
 */
@Injectable()
export class DocumentVersionRepository {
  constructor(private readonly rls: RlsService) {}

  async store(user: AuthUser, params: StoreVersionParams): Promise<StoredVersion> {
    const { input, chunks, embeddingDimensions, publish } = params;

    for (const chunk of chunks) {
      if (chunk.embedding.length !== embeddingDimensions) {
        throw new Error(
          `chunk ${chunk.index} embedding has ${chunk.embedding.length} dims, expected ${embeddingDimensions}`,
        );
      }
    }

    return this.rls.run(user, async (tx) => {
      const documentId = await this.findOrCreateDocument(tx, user, input);
      const versionNumber = await this.nextVersionNumber(tx, documentId);

      const version = await tx.documentVersion.create({
        data: {
          tenantId: user.tenantId,
          documentId,
          versionNumber,
          status: publish ? "published" : "draft",
          changeSummary: input.changeSummary ?? null,
          approvedAt: publish ? new Date() : null,
        },
      });

      const chunkStatus = publish ? "published" : "pending";
      for (const chunk of chunks) {
        const row = await tx.chunk.create({
          data: {
            tenantId: user.tenantId,
            scope: input.scope,
            documentVersionId: version.id,
            chunkIndex: chunk.index,
            content: chunk.content,
            summary: chunk.summary,
            language: input.language,
            status: chunkStatus,
            tokenCount: chunk.tokenCount,
          },
        });
        await tx.$executeRawUnsafe(
          "UPDATE chunks SET embedding = $1::vector WHERE id = $2::uuid",
          toVectorLiteral(chunk.embedding),
          row.id,
        );
      }

      if (publish) {
        await tx.document.update({
          where: { id: documentId },
          data: {
            publishedVersionId: version.id,
            status: "published",
            title: input.title,
          },
        });
      }

      return {
        documentId,
        documentVersionId: version.id,
        versionNumber,
        chunkCount: chunks.length,
        published: publish,
      };
    });
  }

  private async findOrCreateDocument(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    input: IngestionInput,
  ): Promise<string> {
    const existing = await tx.document.findFirst({
      where: { tenantId: user.tenantId, scope: input.scope, sourceUri: input.sourceUri },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }
    const created = await tx.document.create({
      data: {
        tenantId: user.tenantId,
        scope: input.scope,
        // Expert attribution (Security Cycle 2): set once at creation so the chunk-retrieval
        // boundary can restrict this document to its expert's voice (null = shared global corpus).
        expertId: input.expertId ?? null,
        title: input.title,
        sourceUri: input.sourceUri,
        language: input.language,
        status: "draft",
      },
      select: { id: true },
    });
    return created.id;
  }

  private async nextVersionNumber(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<number> {
    const latest = await tx.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }
}
