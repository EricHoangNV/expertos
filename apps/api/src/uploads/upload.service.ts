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
import type { UploadCreateInput, UploadedFileDto } from "@expertos/shared";
import type { Prisma } from "@expertos/db";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { MALWARE_SCANNER, STORAGE_PROVIDER } from "./upload.tokens";
import type { StorageProvider } from "./storage-provider";
import type { MalwareScanner } from "./malware-scanner";
import {
  MAX_UPLOAD_BYTES,
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

/** Prisma `select` that yields exactly an {@link UploadedFileDto} (plus `mode`). */
const UPLOADED_FILE_SELECT = {
  id: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
  mode: true,
  scanned: true,
  scanClean: true,
  conversationId: true,
  createdAt: true,
} satisfies Prisma.UploadedFileSelect;

interface UploadedFileRow {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  mode: "temporary" | "persistent";
  scanned: boolean;
  scanClean: boolean | null;
  conversationId: string | null;
  createdAt: Date;
}

/**
 * Owns query-time document upload (M5.1, PRD §"Document-assisted Q&A"). The flow is:
 * validate type/size → magic-byte check → malware scan → store bytes → persist `uploaded_files`.
 *
 * Uploads are an untrusted trust boundary (PRD §"Security"): the declared content type, filename
 * and bytes are all attacker-controlled, so the file is allowlisted, its extension cross-checked,
 * its leading bytes sniffed, and its content scanned for malware before anything is stored — an
 * infected or spoofed file is rejected and never written. `uploaded_files` is `user_scoped` under
 * Postgres RLS (directive §4.21), so persistence runs inside {@link RlsService.run} and a peer's
 * uploads are invisible; an attached `conversationId` is re-checked for ownership the same way
 * bookmarking does (directive §26), because `conversations` is the real per-user boundary.
 *
 * Storage and scanning sit behind swappable contracts ({@link StorageProvider},
 * {@link MalwareScanner}); the defaults are offline/deterministic. Temporary-vs-persistent
 * retention + indexing is M5.2, so M5.1 stores every file under the DB default (`temporary`).
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly rls: RlsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
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

    // Verify conversation ownership before storing bytes, so a rejected attach leaves no orphan.
    const conversationId = input.conversationId
      ? await this.requireOwnedConversation(user, input.conversationId)
      : null;

    const gcsUri = await this.storage.put({
      key: `uploads/${user.id}/${randomUUID()}/${filename}`,
      content: file.buffer,
      contentType,
    });

    const row = await this.rls.run(user, (tx) =>
      tx.uploadedFile.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          conversationId,
          filename,
          contentType,
          sizeBytes,
          gcsUri,
          scanned: true,
          scanClean: true,
        },
        select: UPLOADED_FILE_SELECT,
      }),
    );

    this.logger.info("file uploaded", {
      uploadedFileId: row.id,
      kind: spec.kind,
      sizeBytes,
      storage: this.storage.name,
    });
    return toUploadedFileDto(row as UploadedFileRow);
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

function toUploadedFileDto(row: UploadedFileRow): UploadedFileDto {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    mode: row.mode,
    scanned: row.scanned,
    scanClean: row.scanClean,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
  };
}
