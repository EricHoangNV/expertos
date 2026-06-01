import { RetentionService } from "./retention.service";
import type { AdminAuditService } from "./admin-audit.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
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
  now: () => NOW_MS,
};

function makeTx() {
  return {
    uploadedFile: { count: jest.fn(), deleteMany: jest.fn() },
    conversation: { count: jest.fn(), deleteMany: jest.fn() },
    usageLog: { count: jest.fn(), deleteMany: jest.fn() },
  };
}

function makeService(tx: ReturnType<typeof makeTx>, policy: RetentionPolicy = POLICY) {
  const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AdminAuditService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  return { service: new RetentionService(rls, audit, logger, policy), run, record, info, tx };
}

describe("RetentionService.preview", () => {
  it("counts expired rows per category without deleting, against one shared cutoff", async () => {
    const tx = makeTx();
    tx.uploadedFile.count.mockResolvedValue(3);
    tx.conversation.count.mockResolvedValue(5);
    tx.usageLog.count.mockResolvedValue(7);
    const { service, run } = makeService(tx);

    const result = await service.preview(ADMIN);

    expect(run).toHaveBeenCalledWith(ADMIN, expect.any(Function));
    expect(result).toEqual({
      asOf: NOW_ISO,
      temporaryUploads: 3,
      expiredConversations: 5,
      oldUsageLogs: 7,
    });
    // Dry run never writes.
    expect(tx.uploadedFile.deleteMany).not.toHaveBeenCalled();
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled();
    expect(tx.usageLog.deleteMany).not.toHaveBeenCalled();
  });

  it("filters temporary uploads on stamped expiry and conversations/usage on policy cutoffs", async () => {
    const tx = makeTx();
    tx.uploadedFile.count.mockResolvedValue(0);
    tx.conversation.count.mockResolvedValue(0);
    tx.usageLog.count.mockResolvedValue(0);
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
  });
});

describe("RetentionService.sweep", () => {
  it("deletes per category, audits the counts in-tx, and reports them", async () => {
    const tx = makeTx();
    tx.uploadedFile.deleteMany.mockResolvedValue({ count: 2 });
    tx.conversation.deleteMany.mockResolvedValue({ count: 4 });
    tx.usageLog.deleteMany.mockResolvedValue({ count: 6 });
    const { service, record, info } = makeService(tx);

    const result = await service.sweep(ADMIN);

    expect(result).toEqual({
      sweptAt: NOW_ISO,
      temporaryUploads: 2,
      expiredConversations: 4,
      oldUsageLogs: 6,
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
        conversationDays: 730,
        usageLogDays: 730,
      },
    });
    expect(info).toHaveBeenCalledWith(
      "retention sweep complete",
      expect.objectContaining({ actorId: ADMIN.id }),
    );
  });

  it("falls back to the wall clock when no `now` seam is configured", async () => {
    const tx = makeTx();
    tx.uploadedFile.deleteMany.mockResolvedValue({ count: 0 });
    tx.conversation.deleteMany.mockResolvedValue({ count: 0 });
    tx.usageLog.deleteMany.mockResolvedValue({ count: 0 });
    const { service } = makeService(tx, { conversationDays: 730, usageLogDays: 730 });

    const before = Date.now();
    const result = await service.sweep(ADMIN);
    const sweptAt = new Date(result.sweptAt).getTime();

    expect(sweptAt).toBeGreaterThanOrEqual(before);
    expect(sweptAt).toBeLessThanOrEqual(Date.now());
  });

  it("honours custom retention windows when computing cutoffs", async () => {
    const tx = makeTx();
    tx.uploadedFile.deleteMany.mockResolvedValue({ count: 0 });
    tx.conversation.deleteMany.mockResolvedValue({ count: 0 });
    tx.usageLog.deleteMany.mockResolvedValue({ count: 0 });
    const { service } = makeService(tx, { conversationDays: 30, usageLogDays: 90, now: () => NOW_MS });

    await service.sweep(ADMIN);

    expect(tx.conversation.deleteMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: new Date(NOW_MS - 30 * DAY_MS) } },
    });
    expect(tx.usageLog.deleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: new Date(NOW_MS - 90 * DAY_MS) } },
    });
  });
});
