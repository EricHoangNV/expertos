import { RetentionService } from "./retention.service";
import type { AdminAuditService } from "./admin-audit.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { StorageProvider } from "../uploads/storage-provider";
import type { RetentionPolicy } from "./retention.config";
import type { AuthUser } from "../auth/auth.types";

const ADMIN: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  firebaseUid: "fb",
  email: "admin@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

/** Fixed clock: 2026-06-01T00:00:00Z. */
const NOW_MS = Date.UTC(2026, 5, 1, 0, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

const POLICY: RetentionPolicy = {
  conversationDays: 730,
  usageLogDays: 730,
  consultationTranscriptDays: 365,
  conciergeRecordDays: 365,
  now: () => NOW_MS,
};

function makeTx() {
  return {
    uploadedFile: { count: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    conversation: { count: jest.fn(), deleteMany: jest.fn() },
    usageLog: { count: jest.fn(), deleteMany: jest.fn() },
    consultationNote: { count: jest.fn(), deleteMany: jest.fn() },
    reviewResponse: { count: jest.fn(), updateMany: jest.fn() },
  };
}

/** The relation filter the consultation-transcript sweep targets, for a given cutoff. */
function transcriptWhere(cutoff: Date) {
  return {
    consultation: {
      OR: [{ scheduledAt: { lt: cutoff } }, { scheduledAt: null, createdAt: { lt: cutoff } }],
    },
  };
}

function makeService(tx: ReturnType<typeof makeTx>, policy: RetentionPolicy = POLICY) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const info = jest.fn();
  const warn = jest.fn();
  const logger = { info, warn } as unknown as StructuredLogger;
  const del = jest.fn().mockResolvedValue(undefined);
  const storage = { name: "mock", put: jest.fn(), delete: del } as unknown as StorageProvider;
  return {
    service: new RetentionService(rls, audit, logger, storage, policy),
    run,
    record,
    info,
    warn,
    del,
    tx,
  };
}

describe("RetentionService.preview", () => {
  it("counts expired rows per category without deleting, against one shared cutoff", async () => {
    const tx = makeTx();
    tx.uploadedFile.count.mockResolvedValue(3);
    tx.conversation.count.mockResolvedValue(5);
    tx.usageLog.count.mockResolvedValue(7);
    tx.consultationNote.count.mockResolvedValue(9);
    tx.reviewResponse.count.mockResolvedValue(11);
    const { service, run } = makeService(tx);

    const result = await service.preview(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result).toEqual({
      asOf: NOW_ISO,
      temporaryUploads: 3,
      expiredConversations: 5,
      oldUsageLogs: 7,
      consultationTranscripts: 9,
      conciergeRecords: 11,
    });
    // Dry run never writes.
    expect(tx.uploadedFile.deleteMany).not.toHaveBeenCalled();
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled();
    expect(tx.usageLog.deleteMany).not.toHaveBeenCalled();
    expect(tx.consultationNote.deleteMany).not.toHaveBeenCalled();
    expect(tx.reviewResponse.updateMany).not.toHaveBeenCalled();
  });

  it("filters every category on its own cutoff (stamped expiry, policy windows, consultation date)", async () => {
    const tx = makeTx();
    tx.uploadedFile.count.mockResolvedValue(0);
    tx.conversation.count.mockResolvedValue(0);
    tx.usageLog.count.mockResolvedValue(0);
    tx.consultationNote.count.mockResolvedValue(0);
    tx.reviewResponse.count.mockResolvedValue(0);
    const { service } = makeService(tx);

    await service.preview(ADMIN);

    expect(tx.uploadedFile.count).toHaveBeenCalledWith({
      where: { mode: "temporary", expiresAt: { lt: new Date(NOW_MS) } },
    });
    expect(tx.conversation.count).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date(NOW_MS - 730 * DAY_MS) } },
    });
    expect(tx.usageLog.count).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date(NOW_MS - 730 * DAY_MS) } },
    });
    expect(tx.consultationNote.count).toHaveBeenCalledWith({
      where: transcriptWhere(new Date(NOW_MS - 365 * DAY_MS)),
    });
    expect(tx.reviewResponse.count).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW_MS - 365 * DAY_MS) }, originalAnswer: { not: "[redacted]" } },
    });
  });
});

describe("RetentionService.sweep", () => {
  function primeSweep(tx: ReturnType<typeof makeTx>, counts = { up: 0, cv: 0, ul: 0, ct: 0, cr: 0 }) {
    tx.uploadedFile.deleteMany.mockResolvedValue({ count: counts.up });
    tx.conversation.deleteMany.mockResolvedValue({ count: counts.cv });
    tx.usageLog.deleteMany.mockResolvedValue({ count: counts.ul });
    tx.consultationNote.deleteMany.mockResolvedValue({ count: counts.ct });
    tx.reviewResponse.updateMany.mockResolvedValue({ count: counts.cr });
  }

  it("deletes/anonymizes per category, audits the counts in-tx, and reports them", async () => {
    const tx = makeTx();
    primeSweep(tx, { up: 2, cv: 4, ul: 6, ct: 8, cr: 10 });
    const { service, record, info } = makeService(tx);

    const result = await service.sweep(ADMIN);

    expect(result).toEqual({
      sweptAt: NOW_ISO,
      temporaryUploads: 2,
      expiredConversations: 4,
      oldUsageLogs: 6,
      consultationTranscripts: 8,
      conciergeRecords: 10,
    });
    expect(tx.uploadedFile.deleteMany).toHaveBeenCalledWith({
      where: { mode: "temporary", expiresAt: { lt: new Date(NOW_MS) } },
    });
    expect(record).toHaveBeenCalledWith(tx, ADMIN, {
      action: "retention.swept",
      targetType: "retention",
      metadata: {
        temporaryUploads: 2,
        expiredConversations: 4,
        oldUsageLogs: 6,
        consultationTranscripts: 8,
        conciergeRecords: 10,
        conversationDays: 730,
        usageLogDays: 730,
        consultationTranscriptDays: 365,
        conciergeRecordDays: 365,
      },
    });
    expect(info).toHaveBeenCalledWith(
      "retention sweep complete",
      expect.objectContaining({ actorId: ADMIN.id }),
    );
  });

  it("reclaims the expiring uploads' raw objects from storage after the rows are deleted", async () => {
    const tx = makeTx();
    primeSweep(tx, { up: 2, cv: 0, ul: 0, ct: 0, cr: 0 });
    tx.uploadedFile.findMany.mockResolvedValue([
      { gcsUri: "memory://uploads/u1/a/x.csv" },
      { gcsUri: null }, // a row that never recorded a URI — skipped, not deleted
      { gcsUri: "memory://uploads/u1/b/y.pdf" },
    ]);
    const { service, del } = makeService(tx);

    await service.sweep(ADMIN);

    // URIs collected before the row delete (deleteMany returns only a count).
    expect(tx.uploadedFile.findMany).toHaveBeenCalledWith({
      where: { mode: "temporary", expiresAt: { lt: new Date(NOW_MS) } },
      select: { gcsUri: true },
    });
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith("memory://uploads/u1/a/x.csv");
    expect(del).toHaveBeenCalledWith("memory://uploads/u1/b/y.pdf");
  });

  it("does not fail the sweep when a storage object delete throws (best-effort)", async () => {
    const tx = makeTx();
    primeSweep(tx, { up: 1, cv: 0, ul: 0, ct: 0, cr: 0 });
    tx.uploadedFile.findMany.mockResolvedValue([{ gcsUri: "memory://uploads/u1/a/x.csv" }]);
    const { service, del, warn } = makeService(tx);
    del.mockRejectedValueOnce(new Error("gcs down"));

    const result = await service.sweep(ADMIN);

    expect(result.temporaryUploads).toBe(1);
    expect(warn).toHaveBeenCalledWith("storage object delete failed", expect.objectContaining({ job: "retention" }));
  });

  it("deletes consultation transcripts on the consultation date but keeps the consultation row", async () => {
    const tx = makeTx();
    primeSweep(tx, { up: 0, cv: 0, ul: 0, ct: 3, cr: 0 });
    const { service } = makeService(tx);

    await service.sweep(ADMIN);

    expect(tx.consultationNote.deleteMany).toHaveBeenCalledWith({
      where: transcriptWhere(new Date(NOW_MS - 365 * DAY_MS)),
    });
  });

  it("anonymizes (not deletes) concierge records, scrubbing text and skipping already-redacted rows", async () => {
    const tx = makeTx();
    primeSweep(tx, { up: 0, cv: 0, ul: 0, ct: 0, cr: 5 });
    const { service } = makeService(tx);

    await service.sweep(ADMIN);

    expect(tx.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(NOW_MS - 365 * DAY_MS) },
        originalAnswer: { not: "[redacted]" },
      },
      data: { originalAnswer: "[redacted]", revisedAnswer: null, notes: null },
    });
  });

  it("falls back to the wall clock when no `now` seam is configured", async () => {
    const tx = makeTx();
    primeSweep(tx);
    const { service } = makeService(tx, {
      conversationDays: 730,
      usageLogDays: 730,
      consultationTranscriptDays: 365,
      conciergeRecordDays: 365,
    });

    const before = Date.now();
    const result = await service.sweep(ADMIN);
    const sweptAt = new Date(result.sweptAt).getTime();

    expect(sweptAt).toBeGreaterThanOrEqual(before);
    expect(sweptAt).toBeLessThanOrEqual(Date.now());
  });

  it("honours custom retention windows when computing cutoffs", async () => {
    const tx = makeTx();
    primeSweep(tx);
    const { service } = makeService(tx, {
      conversationDays: 30,
      usageLogDays: 90,
      consultationTranscriptDays: 120,
      conciergeRecordDays: 200,
      now: () => NOW_MS,
    });

    await service.sweep(ADMIN);

    expect(tx.conversation.deleteMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date(NOW_MS - 30 * DAY_MS) } },
    });
    expect(tx.usageLog.deleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date(NOW_MS - 90 * DAY_MS) } },
    });
    expect(tx.consultationNote.deleteMany).toHaveBeenCalledWith({
      where: transcriptWhere(new Date(NOW_MS - 120 * DAY_MS)),
    });
    expect(tx.reviewResponse.updateMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(NOW_MS - 200 * DAY_MS) },
        originalAnswer: { not: "[redacted]" },
      },
      data: { originalAnswer: "[redacted]", revisedAnswer: null, notes: null },
    });
  });
});
