import { PgUploadChunkStore } from "./upload-chunk.store";
import type { Prisma } from "@expertos/db";

function makeTx(rows: unknown[] = []) {
  const $queryRawUnsafe = jest.fn((_sql: string, ..._params: unknown[]) => Promise.resolve(rows));
  const tx = { $queryRawUnsafe } as unknown as Prisma.TransactionClient;
  return { tx, $queryRawUnsafe };
}

const EMBEDDING = [0.1, 0.2, 0.3];

describe("PgUploadChunkStore", () => {
  it("maps rows to retrieved upload chunks with sheet/cell provenance", async () => {
    const { tx } = makeTx([
      {
        id: "uc1",
        uploaded_file_id: "uf1",
        filename: "budget.xlsx",
        content: "Q1 revenue",
        sheet_name: "Q1 KPIs",
        cell_ref: "A2:B2",
        score: 0.87,
      },
    ]);

    const results = await new PgUploadChunkStore(tx).retrieve({
      embedding: EMBEDDING,
      topK: 5,
      conversationId: "conv-1",
    });

    expect(results).toEqual([
      {
        uploadChunkId: "uc1",
        uploadedFileId: "uf1",
        filename: "budget.xlsx",
        content: "Q1 revenue",
        score: 0.87,
        sheetName: "Q1 KPIs",
        cellRef: "A2:B2",
      },
    ]);
  });

  it("binds the conversation id and filters out expired temporary uploads when scoped", async () => {
    const { tx, $queryRawUnsafe } = makeTx();

    await new PgUploadChunkStore(tx).retrieve({
      embedding: EMBEDDING,
      topK: 7,
      conversationId: "conv-1",
    });

    const [sql, ...params] = $queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("uf.mode = 'temporary'");
    expect(sql).toContain("uf.conversation_id = $2::uuid");
    // Expired temporary uploads are excluded defensively (a sweeper reclaims them later).
    expect(sql).toContain("uf.expires_at IS NULL OR uf.expires_at > now()");
    // params: [vector, conversationId, topK]
    expect(params).toEqual([expect.any(String), "conv-1", 7]);
  });

  it("matches only persistent uploads when no conversation is attached", async () => {
    const { tx, $queryRawUnsafe } = makeTx();

    await new PgUploadChunkStore(tx).retrieve({ embedding: EMBEDDING, topK: 5 });

    const [sql, ...params] = $queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("uf.mode = 'persistent' OR false");
    expect(sql).not.toContain("conversation_id");
    // params: [vector, topK] — no conversation id bound.
    expect(params).toEqual([expect.any(String), 5]);
  });

  it("carries null sheet/cell through for a prose (non-spreadsheet) upload", async () => {
    const { tx } = makeTx([
      {
        id: "uc2",
        uploaded_file_id: "uf2",
        filename: "notes.txt",
        content: "the answer is 42",
        sheet_name: null,
        cell_ref: null,
        score: 0.5,
      },
    ]);

    const [result] = await new PgUploadChunkStore(tx).retrieve({
      embedding: EMBEDDING,
      topK: 5,
    });

    expect(result).toMatchObject({ sheetName: null, cellRef: null, filename: "notes.txt" });
  });
});
