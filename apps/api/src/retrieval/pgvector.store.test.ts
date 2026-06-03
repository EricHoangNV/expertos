import { PgVectorStore } from "./pgvector.store";
import type { Prisma } from "@expertos/db";
import type { RetrievalRequest } from "@expertos/ai";

function makeTx() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const $queryRawUnsafe = jest.fn((sql: string, ...params: unknown[]) => {
    calls.push({ sql, params });
    return Promise.resolve(
      sql.includes("websearch_to_tsquery")
        ? [{ id: "k1", document_version_id: "dv1", content: "kw", score: 0.1 }]
        : [{ id: "v1", document_version_id: "dv2", content: "vec", score: 0.8 }],
    );
  });
  const tx = { $queryRawUnsafe } as unknown as Prisma.TransactionClient;
  return { tx, $queryRawUnsafe, calls };
}

const BASE: RetrievalRequest = {
  text: "file taxes",
  embedding: [0.1, 0.2, 0.3],
  topK: 5,
  filters: { status: "published" },
};

describe("PgVectorStore", () => {
  it("runs both modality queries and fuses the results", async () => {
    const { tx, calls } = makeTx();
    const results = await new PgVectorStore(tx).retrieve(BASE);

    expect(calls).toHaveLength(2);
    // Distinct chunks from each modality both survive into the fused list.
    expect(results.map((r) => r.chunkId).sort()).toEqual(["k1", "v1"]);
  });

  it("binds the status filter and over-fetches topK candidates", async () => {
    const { tx, calls } = makeTx();
    await new PgVectorStore(tx).retrieve(BASE);

    for (const call of calls) {
      expect(call.sql).toContain("status = $");
      // Last bound param is the candidate limit = topK * 4.
      expect(call.params[call.params.length - 1]).toBe(20);
      expect(call.params).toContain("published");
    }
  });

  it("adds language and scope predicates with array binding when present", async () => {
    const { tx, calls } = makeTx();
    await new PgVectorStore(tx).retrieve({
      ...BASE,
      filters: { status: "published", language: "vi", scope: ["global_expert", "tenant_customer"] },
    });

    for (const call of calls) {
      expect(call.sql).toContain("language = $");
      expect(call.sql).toContain("scope = ANY($");
      expect(call.params).toContainEqual(["global_expert", "tenant_customer"]);
      expect(call.params).toContain("vi");
    }
  });

  it("scopes to the selected expert + global knowledge when expertId is set", async () => {
    const { tx, calls } = makeTx();
    await new PgVectorStore(tx).retrieve({
      ...BASE,
      filters: { status: "published", expertId: "11111111-1111-1111-1111-111111111111" },
    });

    for (const call of calls) {
      // Joins back to documents and admits only the expert's own docs OR the global (null) corpus.
      expect(call.sql).toContain("EXISTS (SELECT 1 FROM document_versions dv");
      expect(call.sql).toContain("d.expert_id = $");
      expect(call.sql).toContain("d.expert_id IS NULL");
      expect(call.params).toContain("11111111-1111-1111-1111-111111111111");
    }
  });

  it("omits the expert predicate when no expertId is given (neutral voice)", async () => {
    const { tx, calls } = makeTx();
    await new PgVectorStore(tx).retrieve(BASE);

    for (const call of calls) {
      expect(call.sql).not.toContain("d.expert_id");
    }
  });

  it("skips the keyword query when the text is blank", async () => {
    const { tx, calls } = makeTx();
    const results = await new PgVectorStore(tx).retrieve({ ...BASE, text: "   " });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain("websearch_to_tsquery");
    expect(results.map((r) => r.chunkId)).toEqual(["v1"]);
  });

  it("caps over-fetch at the MAX_CANDIDATES ceiling", async () => {
    const { tx, calls } = makeTx();
    await new PgVectorStore(tx).retrieve({ ...BASE, topK: 50 });

    for (const call of calls) {
      // 50 * 4 = 200 (the cap), not 250.
      expect(call.params[call.params.length - 1]).toBe(200);
    }
  });
});
