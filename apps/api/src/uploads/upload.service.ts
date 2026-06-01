import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { UploadCreateInput, UploadedFileDto, UploadMode } from "@expertos/shared";
import { chunkText, estimateTokens, type EmbeddingProvider } from "@expertos/ai";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { UsageLogService } from "../observability/usage-log.service";
import { toVectorLiteral } from "../database/vector";
import { ParserRegistry } from "../ingestion/parser-registry";
import {
  MALWARE_SCANNER,
  STORAGE_PROVIDER,
  UPLOAD_EMBEDDING_PROVIDER,
  UPLOAD_PARSER_REGISTRY,
} from "./upload.tokens";
import type { StorageProvider } from "./storage-provider";
import type { MalwareScanner } from "./malware-scanner";
import {
  MAX_UPLOAD_BYTES,
  TEMPORARY_RETENTION_DAYS,
  UPLOAD_TYPES,
  normalizeContentType,
  type UploadTypeSpec,
} from "./upload-content-types";

/** A single multipart file part, declared structurally so the service needs no multer types. */
export interface UploadFilePart {
  /** Client-supplied filename (untrusted — sanitized before it is stored/echoed). */
  filename: string;
  /** Client-supplied `Content-Type` (untrusted — validated against {@link UPLOAD_TYPES}). */
  contentType: string;
  buffer: Buffer;
}

/** A processed upload chunk ready to persist (text + embedding + optional spreadsheet provenance). */
interface IndexedChunk {
  index: number;
  content: string;
  tokenCount: number;
  embedding: number[];
  /** Sheet/tab name for a spreadsheet row (M5.3); null for prose chunks. */
  sheetName: string | null;
  /** A1 cell range a spreadsheet chunk covers (M5.3, e.g. `A2:C2`); null for prose chunks. */
  cellRef: string | null;
}

/** The content scope an upload's chunks are stored under, derived from its {@link UploadMode}. */
type UploadScope = "temporary_upload" | "user_private";

/** Prisma `select` that yields the columns an {@link UploadedFileDto} needs. */
const UPLOADED_FILE_SELECT = {
  id: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
  mode: true,
  scanned: true,
  scanClean: true,
  conversationId: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.UploadedFileSelect;

interface UploadedFileRow {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  mode: UploadMode;
  scanned: boolean;
  scanClean: boolean | null;
  conversationId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Owns query-time document upload (M5.1/M5.2, PRD §"Document-assisted Q&A"). The flow is:
 * validate type/size → magic-byte check → malware scan → parse+chunk+embed → store bytes →
 * persist `uploaded_files` + its `upload_chunks` atomically.
 *
 * Uploads are an untrusted trust boundary (PRD §"Security"): the declared content type, filename
 * and bytes are all attacker-controlled, so the file is allowlisted, its extension cross-checked,
 * its leading bytes sniffed, and its content scanned for malware before anything is stored — an
 * infected or spoofed file is rejected and never written. `uploaded_files` is `user_scoped` and
 * `upload_chunks` `tenant_only` under Postgres RLS (directive §4.21), so persistence runs inside
 * {@link RlsService.run} and a peer's uploads are invisible; an attached `conversationId` is
 * re-checked for ownership the same way bookmarking does (directive §26).
 *
 * **Mode (M5.2)** selects retention + indexing strategy:
 * - `temporary` (default) — chunks scoped `temporary_upload` (excluded from the searchable
 *   knowledge base; session-scoped) and the row is stamped with an `expiresAt` so a sweeper can
 *   reclaim it after {@link TEMPORARY_RETENTION_DAYS}.
 * - `persistent` — chunks scoped `user_private`, no expiry, so later questions can retrieve them.
 *
 * Both modes run the file through the same parse→chunk→embed pipeline as ingestion (reusing the
 * `ParserRegistry` + embedding factory so upload vectors share the expert-knowledge space). A
 * format whose parser has not landed yet (PDF/DOCX/XLSX binary parsing is M5.3) is stored but
 * produces zero chunks — `UploadedFileDto.chunkCount` reports `0` so the caller can tell.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly rls: RlsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(UPLOAD_PARSER_REGISTRY) private readonly parsers: ParserRegistry,
    @Inject(UPLOAD_EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    private readonly usage: UsageLogService,
    private readonly logger: StructuredLogger,
  ) {}

  async upload(
    user: AuthUser,
    file: UploadFilePart,
    input: UploadCreateInput,
  ): Promise<UploadedFileDto> {
    const sizeBytes = file.buffer.length;
    if (sizeBytes === 0) {
      throw new BadRequestException("uploaded file is empty");
    }
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `file exceeds the ${MAX_UPLOAD_BYTES}-byte upload limit`,
      );
    }

    const contentType = normalizeContentType(file.contentType);
    const spec = UPLOAD_TYPES[contentType];
    if (!spec) {
      throw new UnsupportedMediaTypeException(
        `unsupported upload type: ${contentType}`,
      );
    }

    const filename = sanitizeFilename(file.filename);
    this.assertExtensionMatches(filename, spec);
    this.assertMagicMatches(file.buffer, spec);

    const scan = await this.scanner.scan(file.buffer);
    if (!scan.clean) {
      // Reject without persisting — never store malware. The signature is for audit only.
      this.logger.warn("upload rejected by malware scan", {
        scanner: this.scanner.name,
        signature: scan.signature ?? null,
        kind: spec.kind,
        sizeBytes,
      });
      throw new UnprocessableEntityException("file failed malware scan");
    }

    // Verify conversation ownership before any storage, so a rejected attach leaves no orphan.
    const conversationId = input.conversationId
      ? await this.requireOwnedConversation(user, input.conversationId)
      : null;

    const mode = input.mode;
    const { scope, expiresAt } = retentionFor(mode);

    // Parse+chunk+embed up front: a failure here stores nothing (no orphan bytes/row). An
    // unparseable-but-allowlisted format (M5.3 binary parsers) yields [] — stored, not indexed.
    const chunks = await this.buildIndexedChunks(file.buffer, contentType);

    const gcsUri = await this.storage.put({
      key: `uploads/${user.id}/${randomUUID()}/${filename}`,
      content: file.buffer,
      contentType,
    });

    const row = await this.rls.run(user, async (tx) => {
      const created = await tx.uploadedFile.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          conversationId,
          scope,
          mode,
          retentionDays: mode === "temporary" ? TEMPORARY_RETENTION_DAYS : null,
          expiresAt,
          filename,
          contentType,
          sizeBytes,
          gcsUri,
          scanned: true,
          scanClean: true,
        },
        select: UPLOADED_FILE_SELECT,
      });
      await this.persistChunks(tx, user, created.id, scope, chunks);
      return created;
    });

    if (chunks.length > 0) {
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      await this.usage.record(user, {
        featureKey: "upload.embed",
        model: this.embeddings.name,
        promptTokens: totalTokens,
        conversationId: conversationId ?? undefined,
      });
    }

    this.logger.info("file uploaded", {
      uploadedFileId: row.id,
      kind: spec.kind,
      mode,
      scope,
      chunkCount: chunks.length,
      sizeBytes,
      storage: this.storage.name,
    });
    return toUploadedFileDto(row as UploadedFileRow, chunks.length);
  }

  /**
   * Parse → chunk → embed the file into searchable chunks. Returns `[]` (stored, not indexed) when
   * no parser is registered for the type yet (PDF/DOCX — M5.3 ships XLSX) or the file parses to no
   * text. A spreadsheet parser emits pre-segmented `parsed.chunks` (one per row, carrying sheet/cell
   * provenance) which are persisted verbatim; everything else is word-windowed via `chunkText`. The
   * embedder is the same factory ingestion/retrieval use, so the vectors are comparable.
   */
  private async buildIndexedChunks(
    buffer: Buffer,
    contentType: string,
  ): Promise<IndexedChunk[]> {
    const parser = this.parsers.tryResolve(contentType);
    if (!parser) {
      return [];
    }
    // Parsing runs on attacker-controlled bytes (PRD §"Security"): a corrupt or malformed file
    // (e.g. a spoofed/truncated XLSX that passed the magic-byte sniff) must not 500 the request or
    // block storage — it is stored unindexed (chunkCount 0), the same as an unsupported format.
    let parsed: Awaited<ReturnType<typeof parser.parse>>;
    try {
      parsed = await parser.parse(buffer);
    } catch (error) {
      this.logger.warn("upload parse failed; storing without indexing", {
        contentType,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const segments: Omit<IndexedChunk, "embedding">[] =
      parsed.chunks && parsed.chunks.length > 0
        ? parsed.chunks.map((chunk, i) => ({
            index: i,
            content: chunk.content,
            tokenCount: estimateTokens(chunk.content),
            sheetName: chunk.sheetName ?? null,
            cellRef: chunk.cellRef ?? null,
          }))
        : chunkText(parsed.text).map((chunk) => ({
            index: chunk.index,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            sheetName: null,
            cellRef: null,
          }));
    if (segments.length === 0) {
      return [];
    }

    const contents = segments.map((chunk) => chunk.content);
    const embeddings = await this.embeddings.embed(contents);
    // The EmbeddingProvider contract guarantees one vector per input, in order — assert it so a
    // misbehaving driver can't silently misalign a vector with the wrong chunk.
    if (embeddings.length !== contents.length) {
      throw new Error(
        `embedding provider returned ${embeddings.length} vectors for ${contents.length} chunks`,
      );
    }

    return segments.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] }));
  }

  /**
   * Persist `upload_chunks` for a stored file. The embedding (`vector(1536)`) is written via raw
   * SQL because Prisma can't map the `Unsupported("vector")` column — same as the ingestion store.
   */
  private async persistChunks(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    uploadedFileId: string,
    scope: UploadScope,
    chunks: IndexedChunk[],
  ): Promise<void> {
    for (const chunk of chunks) {
      const row = await tx.uploadChunk.create({
        data: {
          tenantId: user.tenantId,
          scope,
          uploadedFileId,
          chunkIndex: chunk.index,
          content: chunk.content,
          sheetName: chunk.sheetName,
          cellRef: chunk.cellRef,
        },
        select: { id: true },
      });
      await tx.$executeRawUnsafe(
        "UPDATE upload_chunks SET embedding = $1::vector WHERE id = $2::uuid",
        toVectorLiteral(chunk.embedding),
        row.id,
      );
    }
  }

  /** Reject a filename whose extension isn't one the declared content type legitimately uses. */
  private assertExtensionMatches(filename: string, spec: UploadTypeSpec): void {
    const dot = filename.lastIndexOf(".");
    const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
    if (!spec.extensions.includes(ext)) {
      throw new BadRequestException(
        `filename extension ".${ext}" does not match content type`,
      );
    }
  }

  /** Reject a binary file whose leading bytes don't match its declared format's magic number. */
  private assertMagicMatches(buffer: Buffer, spec: UploadTypeSpec): void {
    if (spec.magic.length === 0) {
      return; // Text formats have no reliable signature.
    }
    const matches =
      buffer.length >= spec.magic.length &&
      spec.magic.every((byte, i) => buffer[i] === byte);
    if (!matches) {
      throw new BadRequestException("file content does not match declared type");
    }
  }

  /**
   * Resolve a conversation id the acting user owns, returning its id. `conversations` is
   * user-scoped under RLS, so a peer's (or a non-existent) conversation reads back null — the real
   * ownership boundary (the same shape `SavedAnswerService` uses).
   */
  private async requireOwnedConversation(
    user: AuthUser,
    conversationId: string,
  ): Promise<string> {
    return this.rls.run(user, async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });
      if (!conversation) {
        throw new NotFoundException("conversation not found");
      }
      return conversation.id;
    });
  }
}

/**
 * Map an upload {@link UploadMode} to its storage scope + expiry (M5.2). `temporary` chunks are
 * session-scoped (`temporary_upload`, excluded from searchable knowledge) and the row expires after
 * {@link TEMPORARY_RETENTION_DAYS}; `persistent` chunks are `user_private` and never expire.
 */
function retentionFor(mode: UploadMode): {
  scope: UploadScope;
  expiresAt: Date | null;
} {
  if (mode === "persistent") {
    return { scope: "user_private", expiresAt: null };
  }
  const expiresAt = new Date(
    Date.now() + TEMPORARY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  return { scope: "temporary_upload", expiresAt };
}

/**
 * Sanitize an untrusted filename for storage + echo-back (directive §1.2): take the basename
 * (strip any path), drop control chars and characters dangerous in a path/markup context, collapse
 * whitespace, NFC-normalize, and length-bound. Falls back to `upload` if nothing survives.
 */
function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex -- strip ASCII control chars + path/markup-unsafe chars
    .replace(/[\x00-\x1f<>:"\\/|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "upload";
}

function toUploadedFileDto(
  row: UploadedFileRow,
  chunkCount: number,
): UploadedFileDto {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    mode: row.mode,
    chunkCount,
    scanned: row.scanned,
    scanClean: row.scanClean,
    conversationId: row.conversationId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
