import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { UploadService, type UploadFilePart } from "./upload.service";
import { MAX_UPLOAD_BYTES } from "./upload-content-types";
import type { RlsService } from "../auth/rls.service";
import type { StorageProvider } from "./storage-provider";
import type { MalwareScanner } from "./malware-scanner";
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
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface Harness {
  service: UploadService;
  put: jest.Mock;
  scan: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  warn: jest.Mock;
  info: jest.Mock;
}

function makeHarness(
  opts: {
    scanResult?: { clean: boolean; signature?: string };
    conversation?: { id: string } | null;
    createRow?: ReturnType<typeof row>;
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
  const warn = jest.fn();
  const info = jest.fn();

  const tx = {
    conversation: { findUnique },
    uploadedFile: { create },
  };
  const rls = {
    run: <T>(_u: AuthUser, work: (t: typeof tx) => Promise<T>) => work(tx),
  } as unknown as RlsService;
  const storage = { name: "mock-store", put } as unknown as StorageProvider;
  const scanner = { name: "mock-scan", scan } as unknown as MalwareScanner;
  const logger = { warn, info } as unknown as StructuredLogger;

  const service = new UploadService(rls, storage, scanner, logger);
  return { service, put, scan, findUnique, create, warn, info };
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
    const dto = await h.service.upload(USER, part(), {});

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

  it("accepts a PDF whose leading bytes match the magic number", async () => {
    const h = makeHarness({ createRow: row({ filename: "doc.pdf", contentType: "application/pdf" }) });
    const dto = await h.service.upload(
      USER,
      part({ filename: "doc.pdf", contentType: "application/pdf", buffer: PDF_BYTES }),
      {},
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
      {},
    );
    expect(h.create).toHaveBeenCalled();
  });

  it("normalizes the content type (strips MIME parameters)", async () => {
    const h = makeHarness();
    await h.service.upload(
      USER,
      part({ contentType: "text/csv; charset=utf-8" }),
      {},
    );
    expect(h.create.mock.calls[0][0].data.contentType).toBe("text/csv");
  });

  it("rejects an empty file", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ buffer: Buffer.alloc(0) }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit before storing", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(
        USER,
        part({ buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1) }),
        {},
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
        {},
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it("rejects when the extension doesn't match the content type (spoof)", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ filename: "evil.exe" }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("rejects a file with no extension", async () => {
    const h = makeHarness();
    await expect(
      h.service.upload(USER, part({ filename: "noextension" }), {}),
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
        {},
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
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects (and never stores) a file that fails the malware scan", async () => {
    const h = makeHarness({ scanResult: { clean: false, signature: "EICAR-Test-File" } });
    await expect(h.service.upload(USER, part(), {})).rejects.toBeInstanceOf(
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
    await expect(h.service.upload(USER, part(), {})).rejects.toBeInstanceOf(
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
    const dto = await h.service.upload(USER, part(), {
      conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
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
      h.service.upload(USER, part(), {
        conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("sanitizes an untrusted filename: strips path + markup-unsafe chars", async () => {
    const h = makeHarness();
    await h.service.upload(
      USER,
      part({ filename: "../../etc/re<port>.csv" }),
      {},
    );
    expect(h.create.mock.calls[0][0].data.filename).toBe("report.csv");
  });

  it("falls back to a default name when nothing survives sanitization", async () => {
    const h = makeHarness();
    // After stripping the markup-unsafe chars the basename is empty, so the sanitizer yields
    // "upload" — which then fails the extension check (no extension), proving the fallback ran.
    await expect(
      h.service.upload(USER, part({ filename: "<>" }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
