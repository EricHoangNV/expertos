import { ConflictException, NotFoundException } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import type { RlsService } from "../auth/rls.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { ResponseCacheService } from "../cache/response-cache.service";
import type { AuthUser } from "../auth/auth.types";

const TENANT = "00000000-0000-0000-0000-000000000000";
const DOC_ID = "11111111-1111-1111-1111-111111111111";
const VERSION_ID = "22222222-2222-2222-2222-222222222222";
const OLD_VERSION_ID = "33333333-3333-3333-3333-333333333333";

const ACTOR: AuthUser = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tenantId: TENANT,
  firebaseUid: "fb-actor",
  email: "expert@expertos.local",
  displayName: "Reviewer",
  role: "expert",
  locale: "en",
};

function vrow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    documentId: DOC_ID,
    versionNumber: 2,
    status: "draft",
    changeSummary: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { chunks: 3 },
    ...overrides,
  };
}

function drow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    title: "Pricing guide",
    scope: "global_expert",
    language: "en",
    status: "draft",
    publishedVersionId: null,
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    versions: [vrow()],
    _count: { versions: 1 },
    ...overrides,
  };
}

interface Tx {
  document: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  documentVersion: { findUnique: jest.Mock; update: jest.Mock };
  chunk: { updateMany: jest.Mock };
}

function makeHarness() {
  const tx: Tx = {
    document: {
      findMany: jest.fn().mockResolvedValue([drow()]),
      findUnique: jest.fn().mockResolvedValue(drow()),
      update: jest.fn().mockResolvedValue(drow()),
    },
    documentVersion: {
      findUnique: jest.fn().mockResolvedValue(vrow()),
      update: jest.fn().mockResolvedValue(vrow()),
    },
    chunk: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const run = jest.fn((_user: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;
  const invalidateTenant = jest.fn().mockResolvedValue(undefined);
  const cache = { invalidateTenant } as unknown as ResponseCacheService;
  const service = new KnowledgeService(rls, logger, cache);
  return { service, tx, run, info, invalidateTenant };
}

describe("KnowledgeService.listDocuments", () => {
  it("applies status + scope filters and maps the latest version + count", async () => {
    const h = makeHarness();
    h.tx.document.findMany.mockResolvedValue([
      drow({ publishedVersionId: VERSION_ID, status: "published", _count: { versions: 4 }, versions: [vrow({ status: "published" })] }),
    ]);

    const result = await h.service.listDocuments(ACTOR, {
      status: "published",
      scope: "global_expert",
      limit: 50,
    });

    expect(h.tx.document.findMany.mock.calls[0][0].where).toEqual({
      status: "published",
      scope: "global_expert",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: DOC_ID,
      versionCount: 4,
      publishedVersionId: VERSION_ID,
    });
    expect(result[0].latestVersion?.isPublished).toBe(true);
  });

  it("returns an empty where + null latestVersion when there are no versions", async () => {
    const h = makeHarness();
    h.tx.document.findMany.mockResolvedValue([drow({ versions: [], _count: { versions: 0 } })]);

    const result = await h.service.listDocuments(ACTOR, { limit: 50 });

    expect(h.tx.document.findMany.mock.calls[0][0].where).toEqual({});
    expect(result[0].latestVersion).toBeNull();
    expect(result[0].versionCount).toBe(0);
  });
});

describe("KnowledgeService.getDocument", () => {
  it("maps the full version history with the isPublished flag", async () => {
    const h = makeHarness();
    h.tx.document.findUnique.mockResolvedValue(
      drow({
        publishedVersionId: OLD_VERSION_ID,
        versions: [vrow({ status: "draft" }), vrow({ id: OLD_VERSION_ID, versionNumber: 1, status: "published" })],
      }),
    );

    const result = await h.service.getDocument(ACTOR, DOC_ID);

    expect(result.versionCount).toBe(2);
    expect(result.versions).toHaveLength(2);
    expect(result.versions[0].isPublished).toBe(false);
    expect(result.versions[1].isPublished).toBe(true);
  });

  it("throws 404 when the document is invisible / missing", async () => {
    const h = makeHarness();
    h.tx.document.findUnique.mockResolvedValue(null);
    await expect(h.service.getDocument(ACTOR, DOC_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("KnowledgeService.submit", () => {
  it("moves a draft to expert_review", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "draft" }));
    h.tx.documentVersion.update.mockResolvedValue(vrow({ status: "expert_review" }));

    const result = await h.service.submit(ACTOR, VERSION_ID);

    expect(h.tx.documentVersion.update.mock.calls[0][0].data).toEqual({ status: "expert_review" });
    // The parent document's status must move in lockstep — the board lists/counts by
    // document.status, so a card only leaves the Draft column if this is kept in sync.
    expect(h.tx.document.update.mock.calls[0][0].data).toEqual({ status: "expert_review" });
    expect(result.status).toBe("expert_review");
  });

  it("rejects submitting a non-draft version", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "published" }));
    await expect(h.service.submit(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("throws 404 when the version is missing", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(null);
    await expect(h.service.submit(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("KnowledgeService.requestChanges", () => {
  it("returns a reviewed version to draft", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "expert_review" }));
    h.tx.documentVersion.update.mockResolvedValue(vrow({ status: "draft" }));

    const result = await h.service.requestChanges(ACTOR, VERSION_ID);

    expect(h.tx.documentVersion.update.mock.calls[0][0].data).toEqual({ status: "draft" });
    expect(h.tx.document.update.mock.calls[0][0].data).toEqual({ status: "draft" });
    expect(result.status).toBe("draft");
  });

  it("rejects requesting changes on a draft version", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "draft" }));
    await expect(h.service.requestChanges(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("KnowledgeService.approve", () => {
  it("publishes a reviewed version: stamps approval, publishes chunks, points the document", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "expert_review" }));
    h.tx.document.findUnique.mockResolvedValue(drow({ publishedVersionId: null }));
    h.tx.documentVersion.update.mockResolvedValue(
      vrow({ status: "published", approvedBy: ACTOR.id, approvedAt: new Date("2026-03-01T00:00:00Z") }),
    );

    const result = await h.service.approve(ACTOR, VERSION_ID);

    // no prior published version → exactly one version update (the publish) + one chunk flip
    expect(h.tx.documentVersion.update).toHaveBeenCalledTimes(1);
    const publishData = h.tx.documentVersion.update.mock.calls[0][0].data;
    expect(publishData.status).toBe("published");
    expect(publishData.approvedBy).toBe(ACTOR.id);
    expect(publishData.approvedAt).toBeInstanceOf(Date);
    expect(h.tx.chunk.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.chunk.updateMany.mock.calls[0][0]).toEqual({
      where: { documentVersionId: VERSION_ID },
      data: { status: "published" },
    });
    expect(h.tx.document.update.mock.calls[0][0].data).toEqual({
      publishedVersionId: VERSION_ID,
      status: "published",
    });
    expect(result.isPublished).toBe(true);
    expect(result.approvedBy).toBe(ACTOR.id);
    // Publishing changed live content → drop the tenant's caches (M6.4 publish-time invalidation).
    expect(h.invalidateTenant).toHaveBeenCalledWith(ACTOR);
  });

  it("supersedes the previously-published version (archives its row + chunks)", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "expert_review" }));
    h.tx.document.findUnique.mockResolvedValue(drow({ publishedVersionId: OLD_VERSION_ID }));
    h.tx.documentVersion.update.mockResolvedValue(vrow({ status: "published" }));

    await h.service.approve(ACTOR, VERSION_ID);

    // old version archived first, then the new version published
    expect(h.tx.documentVersion.update.mock.calls[0][0]).toEqual({
      where: { id: OLD_VERSION_ID },
      data: { status: "archived" },
    });
    expect(h.tx.documentVersion.update).toHaveBeenCalledTimes(2);
    // chunks: old archived + new published
    const chunkTargets = h.tx.chunk.updateMany.mock.calls.map((c) => c[0]);
    expect(chunkTargets).toContainEqual({
      where: { documentVersionId: OLD_VERSION_ID },
      data: { status: "archived" },
    });
    expect(chunkTargets).toContainEqual({
      where: { documentVersionId: VERSION_ID },
      data: { status: "published" },
    });
  });

  it("rejects publishing a version not in expert_review", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "draft" }));
    await expect(h.service.approve(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.document.update).not.toHaveBeenCalled();
    // A rejected publish must not invalidate the cache (nothing changed).
    expect(h.invalidateTenant).not.toHaveBeenCalled();
  });

  it("throws 404 when the owning document has vanished mid-transaction", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "expert_review" }));
    h.tx.document.findUnique.mockResolvedValue(null);
    await expect(h.service.approve(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("KnowledgeService.archive", () => {
  it("retires the live version: archives chunks + clears the document pointer", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "published" }));
    h.tx.document.findUnique.mockResolvedValue(drow({ publishedVersionId: VERSION_ID }));
    h.tx.documentVersion.update.mockResolvedValue(vrow({ status: "archived" }));

    const result = await h.service.archive(ACTOR, VERSION_ID);

    expect(h.tx.chunk.updateMany.mock.calls[0][0]).toEqual({
      where: { documentVersionId: VERSION_ID },
      data: { status: "archived" },
    });
    expect(h.tx.document.update.mock.calls[0][0].data).toEqual({
      publishedVersionId: null,
      status: "archived",
    });
    expect(result.isPublished).toBe(false);
    expect(result.status).toBe("archived");
    // Archiving removed content from retrieval → invalidate the tenant's caches.
    expect(h.invalidateTenant).toHaveBeenCalledWith(ACTOR);
  });

  it("does not touch the document when archiving a non-live published version", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "published" }));
    h.tx.document.findUnique.mockResolvedValue(drow({ publishedVersionId: OLD_VERSION_ID }));
    h.tx.documentVersion.update.mockResolvedValue(vrow({ status: "archived" }));

    await h.service.archive(ACTOR, VERSION_ID);

    expect(h.tx.document.update).not.toHaveBeenCalled();
  });

  it("rejects archiving a version that is not published", async () => {
    const h = makeHarness();
    h.tx.documentVersion.findUnique.mockResolvedValue(vrow({ status: "draft" }));
    await expect(h.service.archive(ACTOR, VERSION_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(h.invalidateTenant).not.toHaveBeenCalled();
  });
});
