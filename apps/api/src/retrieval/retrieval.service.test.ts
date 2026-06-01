import { RetrievalService } from "./retrieval.service";
import type { RlsService } from "../auth/rls.service";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { EmbeddingProvider } from "@expertos/ai";
import type { RetrievalQueryInput } from "@expertos/shared";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const QUERY: RetrievalQueryInput = {
  text: "how do I file taxes",
  topK: 5,
  filters: { status: "published" },
};

/** Fake tx whose raw query returns vector rows then keyword rows by SQL shape. */
function fakeTx(rows: { vector: unknown[]; keyword: unknown[] }) {
  return {
    $queryRawUnsafe: jest.fn((sql: string) =>
      Promise.resolve(sql.includes("websearch_to_tsquery") ? rows.keyword : rows.vector),
    ),
  };
}

interface Harness {
  service: RetrievalService;
  embed: jest.Mock;
  run: jest.Mock;
  record: jest.Mock;
  info: jest.Mock;
  tx: ReturnType<typeof fakeTx>;
}

function makeHarness(
  opts: { dimensions?: number; rows?: { vector: unknown[]; keyword: unknown[] } } = {},
): Harness {
  const dimensions = opts.dimensions ?? 4;
  const embed = jest.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => new Array(dimensions).fill(0.5))),
  );
  const embeddings = { name: "fake-embed", dimensions, embed } as EmbeddingProvider;

  const tx = fakeTx(
    opts.rows ?? {
      vector: [{ id: "c1", document_version_id: "dv1", content: "a", score: 0.9 }],
      keyword: [{ id: "c1", document_version_id: "dv1", content: "a", score: 0.2 }],
    },
  );
  const run = jest.fn((_user: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;

  const record = jest.fn().mockResolvedValue(undefined);
  const usage = { record } as unknown as UsageLogService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;

  const service = new RetrievalService(embeddings, rls, usage, logger);
  return { service, embed, run, record, info, tx };
}

describe("RetrievalService", () => {
  it("embeds the query, runs inside RLS, and returns fused results", async () => {
    const h = makeHarness();
    const results = await h.service.retrieve(USER, QUERY);

    expect(h.embed).toHaveBeenCalledWith([QUERY.text]);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][0]).toBe(USER);
    // c1 matched both modalities -> one fused chunk carrying both raw scores.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      chunkId: "c1",
      documentVersionId: "dv1",
      vectorScore: 0.9,
      keywordScore: 0.2,
    });
  });

  it("records embedding usage and logs the retrieval", async () => {
    const h = makeHarness();
    await h.service.retrieve(USER, QUERY);

    expect(h.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "retrieve.embed", model: "fake-embed" }),
    );
    expect(h.info).toHaveBeenCalledWith(
      "hybrid retrieval completed",
      expect.objectContaining({ results: 1, status: "published" }),
    );
  });

  it("passes the request topK and filters through to the store query", async () => {
    const h = makeHarness();
    await h.service.retrieve(USER, {
      text: "thuế",
      topK: 3,
      filters: { status: "published", language: "vi", scope: ["global_expert"] },
    });

    const sqls = h.tx.$queryRawUnsafe.mock.calls.map((c) => c[0] as string);
    // Both modalities ran; language + scope filters appear in the WHERE.
    expect(sqls).toHaveLength(2);
    expect(sqls.every((s) => s.includes("language ="))).toBe(true);
    expect(sqls.every((s) => s.includes("scope = ANY"))).toBe(true);
  });

  it("throws when the embedding dimensionality is wrong", async () => {
    const embed = jest.fn(() => Promise.resolve([[]]));
    const embeddings = { name: "x", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const run = jest.fn();
    const service = new RetrievalService(
      embeddings,
      { run } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
    );

    await expect(service.retrieve(USER, QUERY)).rejects.toThrow(/expected 4/);
    expect(run).not.toHaveBeenCalled();
  });

  it("throws when the embedder returns no vector at all", async () => {
    const embed = jest.fn(() => Promise.resolve([]));
    const embeddings = { name: "x", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const service = new RetrievalService(
      embeddings,
      { run: jest.fn() } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
    );

    await expect(service.retrieve(USER, QUERY)).rejects.toThrow(/0 dims, expected 4/);
  });
});
