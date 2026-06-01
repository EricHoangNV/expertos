import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { UploadCreateInput } from "@expertos/shared";
import { HashingEmbeddingProvider, type EmbeddingProvider } from "@expertos/ai";
import { UploadService, type UploadFilePart } from "./upload.service";
import { MAX_UPLOAD_BYTES, TEMPORARY_RETENTION_DAYS } from "./upload-content-types";
import { createDefaultParserRegistry } from "../ingestion/ingestion.defaults";
import type { RlsService } from "../auth/rls.service";
import type { StorageProvider } from "./storage-provider";
import type { MalwareScanner } from "./malware-scanner";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "u",
  email: "u@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]); // PK..

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ff000000-0000-0000-0000-000000000001",
    filename: "report.csv",
    contentType: "text/csv",
    sizeBytes: 9,
    mode: "temporary",
    scanned: true,
    scanClean: true,
    conversationId: null,
    expiresAt: new Date("2026-06-08T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Build the JSON metadata that accompanies an upload (mode defaults to temporary). */
function meta(overrides: Partial<UploadCreateInput> = {}): UploadCreateInput {
  return { mode: "temporary", ...overrides };
}

interface Harness {
  service: UploadService;
  put: jest.Mock;
  scan: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  chunkCreate: jest.Mock;
  execRaw: jest.Mock;
  record: jest.Mock;
  warn: jest.Mock;
  info: jest.Mock;
}

function makeHarness(
  opts: {
    scanResult?: { clean: boolean; signature?: string };
    conversation?: { id: string } | null;
    createRow?: ReturnType<typeof row>;
    embedder?: EmbeddingProvider;
  } = {},
): Harness {
  const put = jest.fn().mockResolvedValue("memory://uploads/x");
  const scan = jest
    .fn()
    .mockResolvedValue(opts.scanResult ?? { clean: true });
  const findUnique = jest
    .fn()
    .mockResolvedValue(opts.conversation === undefined ? { id: "c" } : opts.conversation);
  const create = jest.fn().mockResolvedValue(opts.createRow ?? row());
  let chunkSeq = 0;
  const chunkCreate = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ id: `cc00000${++chunkSeq}-0000-0000-0000-000000000001` }),
    );
  const execRaw = jest.fn().mockResolvedValue(1);
  const record = jest.fn().mockResolvedValue(undefined);
  const warn = jest.fn();
  const info = jest.fn();

  const tx = {
    conversation: { findUnique },
    uploadedFile: { create },
    uploadChunk: { create: chunkCreate },
    $executeRawUnsafe: execRaw,
  };
  const rls = {
    run: <T>(_u: AuthUser, work: (t: typeof tx) => Promise<T>) => work(tx),
  } as unknown as RlsService;
  const storage = { name: "mock-store", put } as unknown as StorageProvider;
  const scanner = { name: "mock-scan", scan } as unknown as MalwareScanner;
  const usage = { record } as unknown as UsageLogService;
  const logger = { warn, info } as unknown as StructuredLogger;

  const service = new UploadService(
    rls,
    storage,
    scanner,
    createDefaultParserRegistry(),
    opts.embedder ?? new HashingEmbeddingProvider(),
    usage,
    logger,
  );
  return { service, put, scan, findUnique, create, chunkCreate, execRaw, record, warn, info };
}

function part(overrides: Partial<UploadFilePart> = {}): UploadFilePart {
  return {
    filename: "report.csv",
    contentType: "text/csv",
    buffer: Buffer.from("a,b,c\n1,2,3"),
    ...overrides,
  };
}

describe("UploadService", () => {
  it("uploads a valid text file: stores bytes + persists a row", async () => {
    const h = makeHarness();
    const dto = await h.service.upload(USER, part(), meta());

    expect(h.put).toHaveBeenCalledTimes(1);
    expect(h.put.mock.calls[0][0]).toMatchObject({
      contentType: "text/csv",
      content: expect.any(Buffer),
    });
    // Object key is namespaced by user id (isolation).
    expect(h.put.mock.calls[0][0].key).toContain(`uploads/${USER.id}/`);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      tenantId: USER.tenantId,
      userId: USER.id,
      conversationId: null,
      filename: "report.csv",
      contentType: "text/csv",
      scanned: true,
      scanClean: true,
    });
    expect(dto).toMatchObject({
      id: "ff000000-0000-0000-0000-000000000001",
      mode: "temporary",
      scanned: true,
      scanClean: true,
      createdAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("indexes a temporary upload into session-scoped chunks with an expiry", async () => {
    const h = makeHarness();
    const before = Date.now();
    const dto = await h.service.upload(USER, part(), meta({ mode: "temporary" }));

    // A parseable CSV yields searchable chunks (info-blue upload citations in M5.4).
    expect(h.chunkCreate).toHaveBeenCalled();
    expect(dto.chunkCount).toBeGreaterThan(0);
    expect(h.execRaw).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE upload_chunks SET embedding"),
      expect.any(String),
      expect.any(String),
    );
    // Chunks are scoped to the session and the file row carries a retention window.
    expect(h.chunkCreate.mock.calls[0][0].data.scope).toBe("temporary_upload");
    const fileData = h.create.mock.calls[0][0].data;
    expect(fileData.scope).toBe("temporary_upload");
    expect(fileData.mode).toBe("temporary");
    expect(fileData.retentionDays).toBe(TEMPORARY_RETENTION_DAYS);
    const expiresMs = (fileData.expiresAt as Date).getTime();
    expect(expiresMs).toBeGreaterThan(before);
    expect(expiresMs).toBeLessThanOrEqual(
      before + (TEMPORARY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    // Embedding cost is recorded for the indexed chunks.
    expect(h.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "upload.embed" }),
    );
  });

  it("indexes a persistent upload into user_private chunks with no expiry", async () => {
    const h = makeHarness({
      createRow: row({ mode: "persistent", expiresAt: null }),
    });
    const dto = await h.service.upload(USER, part(), meta({ mode: "persistent" }));

    expect(h.chunkCreate.mock.calls[0][0].data.scope).toBe("user_private");
    const fileData = h.create.mock.calls[0][0].data;
    expect(fileData.scope).toBe("user_private");
    expect(fileData.mode).toBe("persistent");
    expect(fileData.retentionDays).toBeNull();
    expect(fileData.expiresAt).toBeNull();
    expect(dto.mode).toBe("persistent");
    expect(dto.expiresAt).toBeNull();
    expect(dto.chunkCount).toBeGreaterThan(0);
  });

  it("rejects (defensively) when the embedder returns a mismatched vector count", async () => {
    const badEmbedder: EmbeddingProvider = {
      name: "broken",
      dimensions: 1536,
      embed: () => Promise.resolve([]), // fewer vectors than chunks
    };
    const h = makeHarness({ embedder: badEmbedder });
    await expect(h.service.upload(USER, part(), meta())).rejects.toThrow(
      /embedding provider returned/,
    );
    expect(h.create).not.toHaveBeenCalled();
  });

  it("stores an unparseable (PDF) upload without indexing (chunkCount 0)", async () => {
    const h = makeHarness({
      createRow: row({ filename: "doc.pdf", contentType: "application/pdf" }),
    });
    const dto = await h.service.upload(
      USER,
      part({ filename: "doc.pdf", contentType: "application/pdf", buffer: PDF_BYTES }),
      meta({ mode: "persistent" }),
    );

    // No PDF parser yet (M5.3) — bytes stored, but no chunks/embedding cost.
    expect(h.put).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.chunkCreate).not.toHaveBeenCalled();
    expect(h.execRaw).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
    expect(dto.chunkCount).toBe(0);
  });

  it("stores a parseable file that yields no text without indexing", async () => {
    const h = makeHarness();
    // A header-only CSV parses to empty content → no chunks, but the file is still stored.
    const dto = await h.service.upload(
      USER,
      part({ buffer: Buffer.from("a,b,c\n") }),
      meta(),
    );
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.chunkCreate).not.toHaveBeenCalled();
    expect(dto.chunkCount).toBe(0);
  });

  it("accepts a PDF whose leading bytes match the magic number", async () => {
    const h = makeHarness({ createRow: row({ filename: "doc.pdf", contentType: "application/pdf" }) });
    const dto = await h.service.upload(
      USER,
      part({ filename: "doc.pdf", contentType: "application/pdf", buffer: PDF_BYTES }),
      meta(),
    );
    expect(dto.contentType).toBe("application/pdf");
    expect(h.create).toHaveBeenCalled();
  });

  it("accepts an XLSX (ZIP container) by its PK magic", async () => {
    const h = makeHarness();
    await h.service.upload(
      USER,
      part({
        filename: "sheet.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: XLSX_BYTES,
      }),
      meta(),
    );
    expect(h.create).toHaveBeenCalled();
  });

  it("normalizes the content type (strips MIME parameters)", async () => {
    const h = makeHarness();
    await h.service.upload(
      USER,
      part({ contentType: "text/csv; charset=utf-8" }),
      meta(),
    );
    expect(h.create.mock.calls[0][0].data.contentType).toBe("text/csv");
  });

  it("rejects an empty file", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ buffer: Buffer.alloc(0) }), meta()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit before storing", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(
        USER,
        part({ buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1) }),
        meta(),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.scan).not.toHaveBeenCalled();
  });

  it("rejects an unsupported content type", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(
        USER,
        part({ filename: "a.exe", contentType: "application/x-msdownload" }),
        meta(),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it("rejects when the extension doesn't match the content type (spoof)", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ filename: "evil.exe" }), meta()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("rejects a file with no extension", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ filename: "noextension" }), meta()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a binary file whose magic bytes don't match (renamed binary)", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(
        USER,
        part({
          filename: "doc.pdf",
          contentType: "application/pdf",
          buffer: Buffer.from("not a pdf"),
        }),
        meta(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a binary file shorter than its magic number", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(
        USER,
        part({
          filename: "doc.pdf",
          contentType: "application/pdf",
          buffer: Buffer.from([0x25]),
        }),
        meta(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects (and never stores) a file that fails the malware scan", async () => {
    const h = makeHarness({ scanResult: { clean: false, signature: "EICAR-Test-File" } });
    await expect(h.service.upload(USER, part(), meta())).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(h.put).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(
      "upload rejected by malware scan",
      expect.objectContaining({ signature: "EICAR-Test-File" }),
    );
  });

  it("logs a null signature when the scanner reports unclean without one", async () => {
    const h = makeHarness({ scanResult: { clean: false } });
    await expect(h.service.upload(USER, part(), meta())).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(h.warn).toHaveBeenCalledWith(
      "upload rejected by malware scan",
      expect.objectContaining({ signature: null }),
    );
  });

  it("attaches the upload to a conversation the user owns", async () => {
    const h = makeHarness({
      conversation: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      createRow: row({ conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
    });
    const dto = await h.service.upload(USER, part(), meta({
      conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    }));
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      select: { id: true },
    });
    expect(h.create.mock.calls[0][0].data.conversationId).toBe(
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
    );
    expect(dto.conversationId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
  });

  it("404s (and never stores) when attaching to a conversation the user doesn't own", async () => {
    const h = makeHarness({ conversation: null });
    await expect(
      h.service.upload(USER, part(), meta({
        conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("sanitizes an untrusted filename: strips path + markup-unsafe chars", async () => {
    const h = makeHarness();
    await h.service.upload(
      USER,
      part({ filename: "../../etc/re<port>.csv" }),
      meta(),
    );
    expect(h.create.mock.calls[0][0].data.filename).toBe("report.csv");
  });

  it("falls back to a default name when nothing survives sanitization", async () => {
    const h = makeHarness();
    // After stripping the markup-unsafe chars the basename is empty, so the sanitizer yields
    // "upload" — which then fails the extension check (no extension), proving the fallback ran.
    await expect(
      h.service.upload(USER, part({ filename: "<>" }), meta()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
