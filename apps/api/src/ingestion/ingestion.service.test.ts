import { IngestionService, EmptyDocumentError } from "./ingestion.service";
import { UnsupportedContentTypeError } from "./parser-registry";
import type { ParserRegistry } from "./parser-registry";
import type { DocumentVersionRepository, StoredVersion } from "./document-version.repository";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { EmbeddingProvider, Summarizer } from "@expertos/ai";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: null,
  role: "admin",
  locale: "en",
};

const VALID_INPUT = {
  sourceUri: "gs://kb/tax.md",
  title: "Tax Basics",
  contentType: "text/markdown",
};

const STORED: StoredVersion = {
  documentId: "doc-1",
  documentVersionId: "ver-1",
  versionNumber: 1,
  chunkCount: 1,
  published: true,
};

interface Harness {
  service: IngestionService;
  parse: jest.Mock;
  resolve: jest.Mock;
  embed: jest.Mock;
  summarize: jest.Mock;
  store: jest.Mock;
  replaceDraftChunks: jest.Mock;
  record: jest.Mock;
  info: jest.Mock;
}

function makeHarness(opts: { parseText?: string; resolveThrows?: Error } = {}): Harness {
  const parse = jest.fn().mockResolvedValue({ text: opts.parseText ?? "some expert knowledge text" });
  const resolve = jest.fn();
  if (opts.resolveThrows) {
    resolve.mockImplementation(() => {
      throw opts.resolveThrows;
    });
  } else {
    resolve.mockReturnValue({ contentTypes: ["text/markdown"], parse });
  }

  const embed = jest.fn((contents: string[]) => Promise.resolve(contents.map(() => [0, 0, 1])));
  const summarize = jest.fn((c: string) => Promise.resolve(`sum:${c.slice(0, 3)}`));
  const store = jest.fn().mockResolvedValue(STORED);
  const replaceDraftChunks = jest.fn().mockResolvedValue({ versionId: "ver-1", chunkCount: 2 });
  const record = jest.fn().mockResolvedValue(undefined);
  const info = jest.fn();

  const registry = { resolve } as unknown as ParserRegistry;
  const embeddings = { name: "fake-embed", dimensions: 3, embed } as EmbeddingProvider;
  const summarizer = { summarize } as Summarizer;
  const repository = { store, replaceDraftChunks } as unknown as DocumentVersionRepository;
  const usage = { record } as unknown as UsageLogService;
  const logger = { info } as unknown as StructuredLogger;

  const service = new IngestionService(registry, embeddings, summarizer, repository, usage, logger);
  return { service, parse, resolve, embed, summarize, store, replaceDraftChunks, record, info };
}

describe("IngestionService", () => {
  it("runs the full pipeline and publishes by default", async () => {
    const h = makeHarness();
    const result = await h.service.ingest(USER, VALID_INPUT, "some expert knowledge text");

    expect(h.resolve).toHaveBeenCalledWith("text/markdown");
    expect(h.parse).toHaveBeenCalled();
    expect(h.embed).toHaveBeenCalled();
    expect(h.summarize).toHaveBeenCalled();

    const storeArgs = h.store.mock.calls[0];
    expect(storeArgs[0]).toBe(USER);
    expect(storeArgs[1]).toMatchObject({ embeddingDimensions: 3, publish: true });
    expect(storeArgs[1].chunks[0]).toMatchObject({ summary: expect.any(String), embedding: [0, 0, 1] });

    expect(h.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "ingest.embed", model: "fake-embed" }),
    );
    expect(h.info).toHaveBeenCalledWith("Ingested document version", expect.any(Object));
    expect(result).toEqual(STORED);
  });

  it("passes publish:false through to the repository", async () => {
    const h = makeHarness();
    await h.service.ingest(USER, VALID_INPUT, "text", { publish: false });
    expect(h.store.mock.calls[0][1].publish).toBe(false);
  });

  it("throws EmptyDocumentError when the source parses to no chunks", async () => {
    const h = makeHarness({ parseText: "   " });
    await expect(h.service.ingest(USER, VALID_INPUT, "")).rejects.toBeInstanceOf(
      EmptyDocumentError,
    );
    expect(h.store).not.toHaveBeenCalled();
  });

  it("rejects an embedding provider that returns the wrong vector count", async () => {
    const h = makeHarness();
    h.embed.mockResolvedValueOnce([]); // zero vectors for one chunk
    await expect(h.service.ingest(USER, VALID_INPUT, "some expert knowledge text")).rejects.toThrow(
      "returned 0 vectors for 1 chunks",
    );
    expect(h.store).not.toHaveBeenCalled();
  });

  it("validates and rejects malformed input before doing any work", async () => {
    const h = makeHarness();
    await expect(
      h.service.ingest(USER, { sourceUri: "x", contentType: "text/markdown" }, "text"),
    ).rejects.toThrow();
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("propagates an unsupported content type from the registry", async () => {
    const h = makeHarness({ resolveThrows: new UnsupportedContentTypeError("application/pdf") });
    await expect(
      h.service.ingest(USER, { ...VALID_INPUT, contentType: "application/pdf" }, "text"),
    ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
    expect(h.store).not.toHaveBeenCalled();
  });
});

describe("IngestionService.editDraftContent", () => {
  it("re-chunks + re-embeds the new text and replaces the draft's chunks", async () => {
    const h = makeHarness();
    const result = await h.service.editDraftContent(USER, "ver-1", "freshly edited expert text");

    // Re-embedded the edited content, not the original.
    expect(h.embed).toHaveBeenCalledTimes(1);
    expect(h.embed.mock.calls[0][0].join(" ")).toContain("freshly edited expert text");

    // Replaced the draft's chunks (not a new version via store()).
    expect(h.store).not.toHaveBeenCalled();
    expect(h.replaceDraftChunks).toHaveBeenCalledTimes(1);
    const [user, versionId, params] = h.replaceDraftChunks.mock.calls[0];
    expect(user).toBe(USER);
    expect(versionId).toBe("ver-1");
    expect(params.embeddingDimensions).toBe(3);
    expect(params.chunks.length).toBeGreaterThan(0);
    expect(params.chunks[0]).toMatchObject({ index: 0, embedding: [0, 0, 1] });

    // Logged embedding cost under the edit feature key, and returned the repo result.
    expect(h.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "knowledge.edit.embed", model: "fake-embed" }),
    );
    expect(result).toEqual({ versionId: "ver-1", chunkCount: 2 });
  });

  it("rejects empty/whitespace content (no chunks → EmptyDocumentError, nothing written)", async () => {
    const h = makeHarness();
    await expect(h.service.editDraftContent(USER, "ver-1", "   ")).rejects.toBeInstanceOf(
      EmptyDocumentError,
    );
    expect(h.replaceDraftChunks).not.toHaveBeenCalled();
  });
});
