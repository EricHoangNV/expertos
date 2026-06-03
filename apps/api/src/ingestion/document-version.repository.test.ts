import {
  DocumentVersionRepository,
  type StoreVersionParams,
} from "./document-version.repository";
import type { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

interface FakeTx {
  document: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  documentVersion: { findFirst: jest.Mock; create: jest.Mock };
  chunk: { create: jest.Mock };
  $executeRawUnsafe: jest.Mock;
}

function makeTx(overrides: Partial<FakeTx> = {}): FakeTx {
  return {
    document: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "doc-new" }),
      update: jest.fn().mockResolvedValue({}),
      ...overrides.document,
    },
    documentVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "ver-1" }),
      ...overrides.documentVersion,
    },
    chunk: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { chunkIndex: number } }) =>
          Promise.resolve({ id: `chunk-${data.chunkIndex}` }),
        ),
      ...overrides.chunk,
    },
    $executeRawUnsafe: overrides.$executeRawUnsafe ?? jest.fn().mockResolvedValue(1),
  };
}

function repoFor(tx: FakeTx): DocumentVersionRepository {
  const rls = {
    run: <T>(_user: AuthUser, work: (tx: unknown) => Promise<T>) => work(tx),
  } as unknown as RlsService;
  return new DocumentVersionRepository(rls);
}

function params(overrides: Partial<StoreVersionParams> = {}): StoreVersionParams {
  return {
    input: {
      sourceUri: "gs://kb/tax.md",
      title: "Tax Basics",
      scope: "global_expert",
      language: "en",
      contentType: "text/markdown",
    },
    chunks: [
      { index: 0, content: "c0", summary: "s0", tokenCount: 4, embedding: [0.5, -0.5, 0] },
      { index: 1, content: "c1", summary: "s1", tokenCount: 3, embedding: [0, 1, 0] },
    ],
    embeddingDimensions: 3,
    publish: true,
    ...overrides,
  };
}

describe("DocumentVersionRepository", () => {
  it("creates a new document + published v1 with chunks and embeddings", async () => {
    const tx = makeTx();
    const result = await repoFor(tx).store(USER, params());

    expect(tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceUri: "gs://kb/tax.md",
          scope: "global_expert",
          status: "draft",
        }),
      }),
    );
    expect(tx.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNumber: 1, status: "published" }),
      }),
    );
    // approvedAt set on publish
    expect(tx.documentVersion.create.mock.calls[0][0].data.approvedAt).toBeInstanceOf(Date);
    expect(tx.chunk.create).toHaveBeenCalledTimes(2);
    expect(tx.chunk.create.mock.calls[0][0].data.status).toBe("published");
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    // pgvector literal uses fixed-precision (no exponent), targets the new chunk id
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "UPDATE chunks SET embedding = $1::vector WHERE id = $2::uuid",
      "[0.50000000,-0.50000000,0.00000000]",
      "chunk-0",
    );
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-new" },
        data: expect.objectContaining({ publishedVersionId: "ver-1", status: "published" }),
      }),
    );
    expect(result).toEqual({
      documentId: "doc-new",
      documentVersionId: "ver-1",
      versionNumber: 1,
      chunkCount: 2,
      published: true,
    });
  });

  it("attributes a new document to an expert when expertId is given (Security Cycle 2)", async () => {
    const tx = makeTx();
    const expertId = "22222222-2222-2222-2222-222222222222";
    await repoFor(tx).store(USER, params({ input: { ...params().input, expertId } }));

    expect(tx.document.create.mock.calls[0][0].data.expertId).toBe(expertId);
  });

  it("leaves a new document unattributed (global corpus) when no expertId is given", async () => {
    const tx = makeTx();
    await repoFor(tx).store(USER, params());

    expect(tx.document.create.mock.calls[0][0].data.expertId).toBeNull();
  });

  it("appends a new version to an existing document", async () => {
    const tx = makeTx({
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc-existing" }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({ versionNumber: 3 }),
        create: jest.fn().mockResolvedValue({ id: "ver-4" }),
      },
    });
    const result = await repoFor(tx).store(USER, params());

    expect(tx.document.create).not.toHaveBeenCalled();
    expect(tx.documentVersion.create.mock.calls[0][0].data.versionNumber).toBe(4);
    expect(result.versionNumber).toBe(4);
  });

  it("stores a draft (no publish) — pending chunks, no document update", async () => {
    const tx = makeTx();
    const result = await repoFor(tx).store(USER, params({ publish: false }));

    expect(tx.documentVersion.create.mock.calls[0][0].data.status).toBe("draft");
    expect(tx.documentVersion.create.mock.calls[0][0].data.approvedAt).toBeNull();
    expect(tx.chunk.create.mock.calls[0][0].data.status).toBe("pending");
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(result.published).toBe(false);
  });

  it("rejects an embedding whose dimensionality is wrong (before any write)", async () => {
    const tx = makeTx();
    await expect(
      repoFor(tx).store(
        USER,
        params({ chunks: [{ index: 0, content: "c", summary: "s", tokenCount: 1, embedding: [0.1, 0.2] }] }),
      ),
    ).rejects.toThrow("expected 3");
    expect(tx.documentVersion.create).not.toHaveBeenCalled();
  });

  it("rejects a non-finite embedding value", async () => {
    const tx = makeTx();
    await expect(
      repoFor(tx).store(
        USER,
        params({
          chunks: [
            { index: 0, content: "c", summary: "s", tokenCount: 1, embedding: [0.1, Infinity, 0.2] },
          ],
        }),
      ),
    ).rejects.toThrow("non-finite");
  });
});
