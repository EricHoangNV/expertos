import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@expertos/db";
import type {
  KnowledgeDocumentDetailDto,
  KnowledgeDocumentDto,
  KnowledgeListQueryInput,
  KnowledgeVersionDto,
  VersionContentDto,
  ContentScopeValue,
  LanguageValue,
  PublishStatusValue,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { ResponseCacheService } from "../cache/response-cache.service";

/** `select` that yields exactly the fields a {@link KnowledgeVersionDto} needs (+ chunk count). */
const VERSION_SELECT = {
  id: true,
  documentId: true,
  versionNumber: true,
  status: true,
  changeSummary: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.DocumentVersionSelect;

interface VersionRow {
  id: string;
  documentId: string;
  versionNumber: number;
  status: string;
  changeSummary: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  _count: { chunks: number };
}

interface DocumentRow {
  id: string;
  title: string;
  scope: string;
  language: string;
  status: string;
  publishedVersionId: string | null;
  updatedAt: Date;
  versions: VersionRow[];
  _count?: { versions: number };
}

/**
 * Admin/expert knowledge publish workflow (M8.1, PRD §"Admin & Expert portals").
 *
 * Sits on top of the M1.1 ingestion pipeline, which stores an uploaded document as a `draft`
 * version with `pending` chunks (so it is *not* retrieval-visible). This service drives that
 * draft through the expert-review gate:
 *
 *   `draft → expert_review → published`  (`request-changes` returns it to `draft`)
 *   `published → archived`               (retire a live version)
 *
 * Publishing is the gate that makes content live: only {@link approve} flips a version's chunks
 * from `pending` to `published` (the M1.2 retrieval filter is `status = published`), points the
 * parent document's `publishedVersionId` at it, and — crucially — *supersedes* the document's
 * previously-published version by archiving it (status + chunks), so retrieval never returns two
 * generations of the same document at once. {@link archive} reverses this for a live version.
 *
 * Authorization: tenant isolation is enforced structurally by Postgres RLS (directive §4.21) via
 * {@link RlsService}; the controller gates every route at the `expert` role (admin satisfies it via
 * the role hierarchy), so reviewing/publishing is an expert-or-admin action across the tenant.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly rls: RlsService,
    private readonly logger: StructuredLogger,
    private readonly cache: ResponseCacheService,
  ) {}

  /** The review queue / knowledge list — documents with their latest version, newest activity first. */
  async listDocuments(
    user: AuthUser,
    query: KnowledgeListQueryInput,
  ): Promise<KnowledgeDocumentDto[]> {
    const rows = await this.rls.run(user, async (tx) => {
      const where: Prisma.DocumentWhereInput = {};
      if (query.status) {
        where.status = query.status;
      }
      if (query.scope) {
        where.scope = query.scope;
      }
      return (await tx.document.findMany({
        where,
        select: {
          id: true,
          title: true,
          scope: true,
          language: true,
          status: true,
          publishedVersionId: true,
          updatedAt: true,
          _count: { select: { versions: true } },
          versions: { select: VERSION_SELECT, orderBy: { versionNumber: "desc" }, take: 1 },
        },
        orderBy: { updatedAt: "desc" },
        take: query.limit,
      })) as DocumentRow[];
    });

    this.logger.info("knowledge document list completed", {
      status: query.status ?? "any",
      count: rows.length,
    });
    return rows.map(toDocumentDto);
  }

  /** Full document detail with its entire version history (newest first). */
  async getDocument(user: AuthUser, documentId: string): Promise<KnowledgeDocumentDetailDto> {
    return this.rls.run(user, async (tx) => {
      const row = (await tx.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          title: true,
          scope: true,
          language: true,
          status: true,
          publishedVersionId: true,
          updatedAt: true,
          versions: { select: VERSION_SELECT, orderBy: { versionNumber: "desc" } },
        },
      })) as DocumentRow | null;
      if (!row) {
        throw new NotFoundException("document not found");
      }
      return toDetailDto(row);
    });
  }

  /**
   * A version's editable text, reconstructed from its chunks (Option B read-back). The system
   * stores only chunks (overlapping windows), so the text is rebuilt by stitching consecutive
   * chunks and dropping the duplicated overlap — good enough to seed the editor; on save the edited
   * text is re-chunked from scratch. The returned `status` lets the UI gate editing to drafts.
   */
  async getVersionContent(user: AuthUser, versionId: string): Promise<VersionContentDto> {
    return this.rls.run(user, async (tx) => {
      const version = await tx.documentVersion.findUnique({
        where: { id: versionId },
        select: { id: true, status: true },
      });
      if (!version) {
        throw new NotFoundException("document version not found");
      }
      const chunks = await tx.chunk.findMany({
        where: { documentVersionId: versionId },
        orderBy: { chunkIndex: "asc" },
        select: { content: true },
      });
      return {
        versionId,
        status: version.status as PublishStatusValue,
        content: reconstructFromChunks(chunks.map((c) => c.content)),
        chunkCount: chunks.length,
      };
    });
  }

  /** Submit a draft version for expert review (`draft` → `expert_review`). */
  submit(user: AuthUser, versionId: string): Promise<KnowledgeVersionDto> {
    return this.transition(user, versionId, {
      from: "draft",
      to: "expert_review",
      event: "knowledge version submitted for review",
    });
  }

  /** Return a reviewed version to the author for changes (`expert_review` → `draft`). */
  requestChanges(user: AuthUser, versionId: string): Promise<KnowledgeVersionDto> {
    return this.transition(user, versionId, {
      from: "expert_review",
      to: "draft",
      event: "knowledge version changes requested",
    });
  }

  /**
   * Sign off on a reviewed version, publishing it (`expert_review` → `published`). This is the
   * expert-review gate: it flips the version's chunks to `published` (retrieval-visible), points
   * the document at it, and archives the document's previously-published version (+ its chunks)
   * so only one generation is ever live.
   */
  async approve(user: AuthUser, versionId: string): Promise<KnowledgeVersionDto> {
    const dto = await this.rls.run(user, async (tx) => {
      const version = await this.loadVersion(tx, versionId);
      if (version.status !== "expert_review") {
        throw new ConflictException(`cannot publish a ${version.status} version`);
      }

      const document = await this.loadDocument(tx, version.documentId);
      const now = new Date();

      // Supersede the previously-published version (if any other) so retrieval never sees two.
      if (document.publishedVersionId && document.publishedVersionId !== version.id) {
        await tx.documentVersion.update({
          where: { id: document.publishedVersionId },
          data: { status: "archived" },
        });
        await tx.chunk.updateMany({
          where: { documentVersionId: document.publishedVersionId },
          data: { status: "archived" },
        });
      }

      const updated = (await tx.documentVersion.update({
        where: { id: versionId },
        data: { status: "published", approvedBy: user.id, approvedAt: now },
        select: VERSION_SELECT,
      })) as VersionRow;
      await tx.chunk.updateMany({
        where: { documentVersionId: versionId },
        data: { status: "published" },
      });
      await tx.document.update({
        where: { id: version.documentId },
        data: { publishedVersionId: versionId, status: "published" },
      });

      this.logger.info("knowledge version published", {
        versionId,
        documentId: version.documentId,
        supersededVersionId:
          document.publishedVersionId && document.publishedVersionId !== version.id
            ? document.publishedVersionId
            : null,
      });
      return toVersionDto(updated, versionId);
    });

    // Live content changed — drop the tenant's cached retrieval/answers (M6.4 publish-time
    // invalidation) so the newly-published version is reflected immediately, not after the TTL.
    await this.cache.invalidateTenant(user);
    return dto;
  }

  /**
   * Retire a published version (`published` → `archived`): archive its chunks and, if it was the
   * document's live version, clear the pointer and mark the document archived.
   */
  async archive(user: AuthUser, versionId: string): Promise<KnowledgeVersionDto> {
    const dto = await this.rls.run(user, async (tx) => {
      const version = await this.loadVersion(tx, versionId);
      if (version.status !== "published") {
        throw new ConflictException(`cannot archive a ${version.status} version`);
      }

      const document = await this.loadDocument(tx, version.documentId);
      const updated = (await tx.documentVersion.update({
        where: { id: versionId },
        data: { status: "archived" },
        select: VERSION_SELECT,
      })) as VersionRow;
      await tx.chunk.updateMany({
        where: { documentVersionId: versionId },
        data: { status: "archived" },
      });
      if (document.publishedVersionId === versionId) {
        await tx.document.update({
          where: { id: version.documentId },
          data: { publishedVersionId: null, status: "archived" },
        });
      }

      this.logger.info("knowledge version archived", {
        versionId,
        documentId: version.documentId,
      });
      // After archiving the live version the document has no published version.
      return toVersionDto(updated, document.publishedVersionId === versionId ? null : document.publishedVersionId);
    });

    // Archiving removes a version from retrieval — drop the tenant's cache so answers that cited
    // it are not served stale (M6.4 publish-time invalidation).
    await this.cache.invalidateTenant(user);
    return dto;
  }

  /** Shared simple state move (no chunk/document side effects): assert status, update, log. */
  private async transition(
    user: AuthUser,
    versionId: string,
    spec: { from: string; to: "draft" | "expert_review"; event: string },
  ): Promise<KnowledgeVersionDto> {
    return this.rls.run(user, async (tx) => {
      const version = await this.loadVersion(tx, versionId);
      if (version.status !== spec.from) {
        throw new ConflictException(`cannot transition a ${version.status} version`);
      }
      const document = await this.loadDocument(tx, version.documentId);
      const updated = (await tx.documentVersion.update({
        where: { id: versionId },
        data: { status: spec.to },
        select: VERSION_SELECT,
      })) as VersionRow;
      // Keep the parent document's status in lockstep with its latest version (as approve/archive
      // do) — the board lists/counts documents by `document.status`, so without this the card
      // never leaves the Draft column after a submit.
      await tx.document.update({
        where: { id: version.documentId },
        data: { status: spec.to },
      });

      this.logger.info(spec.event, { versionId, status: spec.to });
      return toVersionDto(updated, document.publishedVersionId);
    });
  }

  /** Load a version row or 404. RLS makes a peer tenant's version invisible (→ not found). */
  private async loadVersion(
    tx: Prisma.TransactionClient,
    versionId: string,
  ): Promise<VersionRow> {
    const row = (await tx.documentVersion.findUnique({
      where: { id: versionId },
      select: VERSION_SELECT,
    })) as VersionRow | null;
    if (!row) {
      throw new NotFoundException("document version not found");
    }
    return row;
  }

  /** Load the owning document's pointer fields (the version already proved tenant visibility). */
  private async loadDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<{ publishedVersionId: string | null }> {
    const row = await tx.document.findUnique({
      where: { id: documentId },
      select: { publishedVersionId: true },
    });
    if (!row) {
      throw new NotFoundException("document not found");
    }
    return row;
  }
}

/** Map a version row to its DTO; `publishedVersionId` decides the `isPublished` flag. */
function toVersionDto(row: VersionRow, publishedVersionId: string | null): KnowledgeVersionDto {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    status: row.status as PublishStatusValue,
    changeSummary: row.changeSummary,
    chunkCount: row._count.chunks,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isPublished: publishedVersionId !== null && row.id === publishedVersionId,
  };
}

/** Map a list-row (latest version only, `_count.versions`) to the summary DTO. */
function toDocumentDto(row: DocumentRow): KnowledgeDocumentDto {
  const latest = row.versions[0];
  return {
    id: row.id,
    title: row.title,
    scope: row.scope as ContentScopeValue,
    language: row.language as LanguageValue,
    status: row.status as PublishStatusValue,
    publishedVersionId: row.publishedVersionId,
    versionCount: row._count?.versions ?? row.versions.length,
    latestVersion: latest ? toVersionDto(latest, row.publishedVersionId) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Map a detail-row (full version history) to the detail DTO. */
function toDetailDto(row: DocumentRow): KnowledgeDocumentDetailDto {
  return {
    ...toDocumentDto(row),
    versionCount: row.versions.length,
    versions: row.versions.map((v) => toVersionDto(v, row.publishedVersionId)),
  };
}

/**
 * Rebuild a version's text from its (overlapping) chunks for the editor. Consecutive ingestion
 * chunks share a trailing/leading word overlap; we stitch them by detecting the largest suffix of
 * the accumulated text that prefixes the next chunk and appending only the non-overlapping tail.
 * Lossy on the original whitespace (chunks store words joined by single spaces) but content-faithful
 * — and the save path re-chunks the edited text from scratch, so round-trips stay stable.
 */
function reconstructFromChunks(chunkContents: string[]): string {
  const wordsOf = (s: string): string[] => s.split(/\s+/).filter((w) => w.length > 0);
  if (chunkContents.length === 0) return "";
  const out = wordsOf(chunkContents[0]);
  for (let i = 1; i < chunkContents.length; i++) {
    const next = wordsOf(chunkContents[i]);
    const cap = Math.min(out.length, next.length, 120);
    let overlap = 0;
    for (let k = cap; k > 0; k--) {
      let match = true;
      for (let j = 0; j < k; j++) {
        if (out[out.length - k + j] !== next[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        overlap = k;
        break;
      }
    }
    for (let j = overlap; j < next.length; j++) out.push(next[j]);
  }
  return out.join(" ");
}
