import { RetrievalService } from "./retrieval.service";
import type { RlsService } from "../auth/rls.service";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { EmbeddingProvider, RetrievedChunk } from "@expertos/ai";
import type { RetrievalQueryInput } from "@expertos/shared";
import type { ResponseCacheService } from "../cache/response-cache.service";
import type { SettingsService } from "../settings/settings.service";

/** A {@link SettingsService} stub whose `getCached` returns the given retrieval floor (default off). */
function fakeSettings(retrievalScoreFloor = 0): {
  settings: SettingsService;
  getCached: jest.Mock;
} {
  const getCached = jest.fn().mockResolvedValue({
    llmTemperature: 0.2,
    defaultChatModel: "gpt-4o-mini",
    retrievalScoreFloor,
  });
  return { settings: { getCached } as unknown as SettingsService, getCached };
}

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
  getRetrieval: jest.Mock;
  setRetrieval: jest.Mock;
  retrievalKey: jest.Mock;
  getCached: jest.Mock;
}

function makeHarness(
  opts: {
    dimensions?: number;
    rows?: { vector: unknown[]; keyword: unknown[] };
    cacheHit?: RetrievedChunk[];
    retrievalScoreFloor?: number;
  } = {},
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

  const getRetrieval = jest.fn().mockReturnValue(opts.cacheHit);
  const setRetrieval = jest.fn();
  const retrievalKey = jest.fn().mockReturnValue("retrieval-key");
  const cache = {
    retrievalKey,
    getRetrieval,
    setRetrieval,
  } as unknown as ResponseCacheService;

  const { settings, getCached } = fakeSettings(opts.retrievalScoreFloor);

  const service = new RetrievalService(embeddings, rls, usage, logger, cache, settings);
  return { service, embed, run, record, info, tx, getRetrieval, setRetrieval, retrievalKey, getCached };
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

  it("returns cached chunks without embedding, DB, or usage on a retrieval cache hit (M6.4)", async () => {
    const cached: RetrievedChunk[] = [
      { chunkId: "cached", documentVersionId: "dv9", content: "from cache", score: 0.7 },
    ];
    const h = makeHarness({ cacheHit: cached });

    const results = await h.service.retrieve(USER, QUERY);

    expect(results).toBe(cached);
    // Skipped the expensive work entirely: no embed, no DB transaction, no embed-usage logging.
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.setRetrieval).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledWith(
      "hybrid retrieval cache hit",
      expect.objectContaining({ results: 1 }),
    );
  });

  it("caches the fused results after a retrieval cache miss (M6.4)", async () => {
    const h = makeHarness();

    const results = await h.service.retrieve(USER, QUERY);

    expect(h.embed).toHaveBeenCalledTimes(1);
    expect(h.setRetrieval).toHaveBeenCalledWith("retrieval-key", results);
  });

  it("reads the retrieval score floor from settings and forks the cache key on it (M17.4)", async () => {
    const h = makeHarness({ retrievalScoreFloor: 0.02 });
    await h.service.retrieve(USER, QUERY);

    expect(h.getCached).toHaveBeenCalledTimes(1);
    // The floor is part of the cache key so a floor change can't serve chunks filtered under the old.
    expect(h.retrievalKey).toHaveBeenCalledWith(USER.tenantId, QUERY, 0.02);
  });

  it("drops fused chunks scoring below the retrieval floor (M17.4)", async () => {
    // The default rows put c1 in both modalities → fused RRF ≈ 0.033; a floor above that filters it.
    const h = makeHarness({ retrievalScoreFloor: 0.05 });
    const results = await h.service.retrieve(USER, QUERY);

    expect(results).toEqual([]);
    expect(h.info).toHaveBeenCalledWith(
      "hybrid retrieval completed",
      expect.objectContaining({ results: 0 }),
    );
  });

  it("keeps every chunk when the floor is off (default 0) (M17.4)", async () => {
    const h = makeHarness();
    const results = await h.service.retrieve(USER, QUERY);

    expect(h.retrievalKey).toHaveBeenCalledWith(USER.tenantId, QUERY, 0);
    expect(results).toHaveLength(1);
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
      {
        retrievalKey: jest.fn().mockReturnValue("k"),
        getRetrieval: jest.fn().mockReturnValue(undefined),
        setRetrieval: jest.fn(),
      } as unknown as ResponseCacheService,
      fakeSettings().settings,
    );

    await expect(service.retrieve(USER, QUERY)).rejects.toThrow(/expected 4/);
    expect(run).not.toHaveBeenCalled();
  });

  it("folds the user's uploads in, scoped to the conversation, and records upload usage (M5.4)", async () => {
    const uploadRow = {
      id: "uc1",
      uploaded_file_id: "uf1",
      filename: "budget.xlsx",
      content: "Q1 revenue",
      sheet_name: "Q1 KPIs",
      cell_ref: "A2:B2",
      score: 0.9,
    };
    const queryRawUnsafe = jest.fn().mockResolvedValue([uploadRow]);
    const tx = { $queryRawUnsafe: queryRawUnsafe };
    const embed = jest.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(4).fill(0.5))),
    );
    const embeddings = { name: "fake-embed", dimensions: 4, embed } as EmbeddingProvider;
    const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
    const record = jest.fn().mockResolvedValue(undefined);
    const info = jest.fn();
    const service = new RetrievalService(
      embeddings,
      { run } as unknown as RlsService,
      { record } as unknown as UsageLogService,
      { info } as unknown as StructuredLogger,
      {
        retrievalKey: jest.fn().mockReturnValue("k"),
        getRetrieval: jest.fn().mockReturnValue(undefined),
        setRetrieval: jest.fn(),
      } as unknown as ResponseCacheService,
      fakeSettings().settings,
    );

    const results = await service.retrieveUploads(USER, {
      text: "revenue?",
      topK: 5,
      conversationId: "conv-1",
    });

    expect(results).toEqual([
      {
        uploadChunkId: "uc1",
        uploadedFileId: "uf1",
        filename: "budget.xlsx",
        content: "Q1 revenue",
        score: 0.9,
        sheetName: "Q1 KPIs",
        cellRef: "A2:B2",
      },
    ]);
    // The conversation id is bound (temporary uploads are session-scoped) and the SQL joins files.
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("upload_chunks");
    expect(sql).toContain("JOIN uploaded_files");
    expect(queryRawUnsafe.mock.calls[0]).toContain("conv-1");
    expect(record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "upload.retrieve.embed", model: "fake-embed" }),
    );
    expect(info).toHaveBeenCalledWith(
      "upload retrieval completed",
      expect.objectContaining({ results: 1, conversationScoped: true }),
    );
  });

  it("restricts uploads to persistent-only when no conversation is attached (M5.4)", async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const tx = { $queryRawUnsafe: queryRawUnsafe };
    const embed = jest.fn(() => Promise.resolve([new Array(4).fill(0.5)]));
    const embeddings = { name: "fake-embed", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const run = jest.fn((_u: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
    const service = new RetrievalService(
      embeddings,
      { run } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
      {
        retrievalKey: jest.fn().mockReturnValue("k"),
        getRetrieval: jest.fn().mockReturnValue(undefined),
        setRetrieval: jest.fn(),
      } as unknown as ResponseCacheService,
      fakeSettings().settings,
    );

    const results = await service.retrieveUploads(USER, { text: "q", topK: 5 });

    expect(results).toEqual([]);
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    // No conversation → the temporary branch is a constant false, so only persistent uploads match.
    expect(sql).toContain("uf.mode = 'persistent' OR false");
    // Only the query vector + limit are bound (no conversation id).
    expect(queryRawUnsafe.mock.calls[0]).toHaveLength(3);
  });

  it("throws when the embedder returns no vector at all", async () => {
    const embed = jest.fn(() => Promise.resolve([]));
    const embeddings = { name: "x", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const service = new RetrievalService(
      embeddings,
      { run: jest.fn() } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
      {
        retrievalKey: jest.fn().mockReturnValue("k"),
        getRetrieval: jest.fn().mockReturnValue(undefined),
        setRetrieval: jest.fn(),
      } as unknown as ResponseCacheService,
      fakeSettings().settings,
    );

    await expect(service.retrieve(USER, QUERY)).rejects.toThrow(/0 dims, expected 4/);
  });
});
