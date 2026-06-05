import type { Prisma } from "@expertos/db";
import { publishReviewedVersionTx, NotReviewedError } from "./publish-version";
import type { VersionRow } from "./knowledge.constants";

const VERSION_ID = "11111111-1111-1111-1111-111111111111";
const OLD_VERSION_ID = "22222222-2222-2222-2222-222222222222";
const DOC_ID = "33333333-3333-3333-3333-333333333333";
const APPROVER_ID = "44444444-4444-4444-4444-444444444444";

function vrow(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: VERSION_ID,
    documentId: DOC_ID,
    versionNumber: 2,
    status: "published",
    changeSummary: null,
    approvedBy: APPROVER_ID,
    approvedAt: new Date("2026-06-05T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    _count: { chunks: 3 },
    ...overrides,
  };
}

function makeTx() {
  return {
    documentVersion: { update: jest.fn().mockResolvedValue(vrow()) },
    chunk: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    document: { update: jest.fn().mockResolvedValue({}) },
  } as unknown as jest.Mocked<Prisma.TransactionClient> & {
    documentVersion: { update: jest.Mock };
    chunk: { updateMany: jest.Mock };
    document: { update: jest.Mock };
  };
}

describe("publishReviewedVersionTx", () => {
  it.each(["draft", "published", "archived", "ai_processing"])(
    "refuses to publish a %s version (the expert-review gate) — no writes",
    async (status) => {
      const tx = makeTx();
      await expect(
        publishReviewedVersionTx(tx, {
          versionId: VERSION_ID,
          versionStatus: status,
          currentPublishedVersionId: null,
          approverId: APPROVER_ID,
        }),
      ).rejects.toBeInstanceOf(NotReviewedError);
      expect(tx.documentVersion.update).not.toHaveBeenCalled();
      expect(tx.chunk.updateMany).not.toHaveBeenCalled();
      expect(tx.document.update).not.toHaveBeenCalled();
    },
  );

  it("publishes an expert_review version: stamps approval, publishes chunks, points the document", async () => {
    const tx = makeTx();
    const now = new Date("2026-06-05T12:00:00Z");

    const updated = await publishReviewedVersionTx(tx, {
      versionId: VERSION_ID,
      versionStatus: "expert_review",
      currentPublishedVersionId: null,
      approverId: APPROVER_ID,
      now,
    });

    // no prior published → exactly one version update (the publish) + one chunk flip
    expect(tx.documentVersion.update).toHaveBeenCalledTimes(1);
    expect(tx.documentVersion.update.mock.calls[0][0].data).toEqual({
      status: "published",
      approvedBy: APPROVER_ID,
      approvedAt: now,
    });
    expect(tx.chunk.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.chunk.updateMany.mock.calls[0][0]).toEqual({
      where: { documentVersionId: VERSION_ID },
      data: { status: "published" },
    });
    expect(tx.document.update.mock.calls[0][0]).toEqual({
      where: { id: DOC_ID },
      data: { publishedVersionId: VERSION_ID, status: "published" },
    });
    expect(updated.status).toBe("published");
  });

  it("supersedes the previously-published version (archives its row + chunks) first", async () => {
    const tx = makeTx();

    await publishReviewedVersionTx(tx, {
      versionId: VERSION_ID,
      versionStatus: "expert_review",
      currentPublishedVersionId: OLD_VERSION_ID,
      approverId: APPROVER_ID,
    });

    // old version archived first, then the new one published
    expect(tx.documentVersion.update.mock.calls[0][0]).toEqual({
      where: { id: OLD_VERSION_ID },
      data: { status: "archived" },
    });
    expect(tx.documentVersion.update).toHaveBeenCalledTimes(2);
    const chunkTargets = tx.chunk.updateMany.mock.calls.map((c) => c[0]);
    expect(chunkTargets).toContainEqual({
      where: { documentVersionId: OLD_VERSION_ID },
      data: { status: "archived" },
    });
    expect(chunkTargets).toContainEqual({
      where: { documentVersionId: VERSION_ID },
      data: { status: "published" },
    });
  });

  it("does not supersede when the document already points at this same version", async () => {
    const tx = makeTx();
    await publishReviewedVersionTx(tx, {
      versionId: VERSION_ID,
      versionStatus: "expert_review",
      currentPublishedVersionId: VERSION_ID, // same id → nothing to archive
      approverId: APPROVER_ID,
    });
    expect(tx.documentVersion.update).toHaveBeenCalledTimes(1); // only the publish
  });
});
