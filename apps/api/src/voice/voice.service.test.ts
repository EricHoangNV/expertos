import { VoiceService } from "./voice.service";
import type { RlsService } from "../auth/rls.service";
import type { UsageLogService } from "../observability/usage-log.service";
import type { StructuredLogger } from "../observability/logger.service";
import type { AuthUser } from "../auth/auth.types";
import type { EmbeddingProvider } from "@expertos/ai";
import type { VoiceQueryInput } from "@expertos/shared";

const USER: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  firebaseUid: "system",
  email: "system@expertos.local",
  displayName: null,
  role: "user",
  locale: "en",
};

const QUERY: VoiceQueryInput = {
  expertId: "22222222-2222-2222-2222-222222222222",
  text: "how should I price my service?",
  language: "en",
  topK: 3,
};

const PROFILE_ROW = {
  voice_profile_id: "vp1",
  expert_name: "Dr. Lan",
  guidelines: "Be direct.",
};
const EXAMPLE_ROWS = [
  { id: "ve1", prompt: "pricing", content: "Charge for value.", score: 0.9 },
];

function fakeTx(profileRows: unknown[], exampleRows: unknown[]) {
  return {
    $queryRawUnsafe: jest.fn((sql: string) =>
      Promise.resolve(sql.includes("voice_profiles") ? profileRows : exampleRows),
    ),
  };
}

interface Harness {
  service: VoiceService;
  embed: jest.Mock;
  run: jest.Mock;
  record: jest.Mock;
  info: jest.Mock;
  tx: ReturnType<typeof fakeTx>;
}

function makeHarness(
  opts: {
    dimensions?: number;
    profileRows?: unknown[];
    exampleRows?: unknown[];
  } = {},
): Harness {
  const dimensions = opts.dimensions ?? 4;
  const embed = jest.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => new Array(dimensions).fill(0.5))),
  );
  const embeddings = { name: "fake-embed", dimensions, embed } as EmbeddingProvider;

  const tx = fakeTx(opts.profileRows ?? [PROFILE_ROW], opts.exampleRows ?? EXAMPLE_ROWS);
  const run = jest.fn((_user: AuthUser, work: (tx: unknown) => Promise<unknown>) => work(tx));
  const rls = { run } as unknown as RlsService;

  const record = jest.fn().mockResolvedValue(undefined);
  const usage = { record } as unknown as UsageLogService;
  const info = jest.fn();
  const logger = { info } as unknown as StructuredLogger;

  const service = new VoiceService(embeddings, rls, usage, logger);
  return { service, embed, run, record, info, tx };
}

describe("VoiceService", () => {
  it("embeds the topic, resolves the profile, and retrieves examples inside RLS", async () => {
    const h = makeHarness();
    const result = await h.service.retrieveVoice(USER, QUERY);

    expect(h.embed).toHaveBeenCalledWith([QUERY.text]);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][0]).toBe(USER);
    expect(result.profile).toEqual({
      voiceProfileId: "vp1",
      expertName: "Dr. Lan",
      guidelines: "Be direct.",
    });
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0].content).toBe("Charge for value.");
    expect(result.language).toBe("en");
  });

  it("returns an empty voice layer and skips the example query when no profile exists", async () => {
    const h = makeHarness({ profileRows: [] });
    const result = await h.service.retrieveVoice(USER, QUERY);

    expect(result.profile).toBeNull();
    expect(result.examples).toEqual([]);
    // Only the profile lookup ran — no example cosine query when there is no profile.
    expect(h.tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("records embedding usage and logs the retrieval", async () => {
    const h = makeHarness();
    await h.service.retrieveVoice(USER, QUERY);

    expect(h.record).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ featureKey: "voice.embed", model: "fake-embed" }),
    );
    expect(h.info).toHaveBeenCalledWith(
      "voice retrieval completed",
      expect.objectContaining({ profileFound: true, examples: 1, language: "en" }),
    );
  });

  it("throws when the embedding dimensionality is wrong and never touches the DB", async () => {
    const embed = jest.fn(() => Promise.resolve([[]]));
    const embeddings = { name: "x", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const run = jest.fn();
    const service = new VoiceService(
      embeddings,
      { run } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
    );

    await expect(service.retrieveVoice(USER, QUERY)).rejects.toThrow(/expected 4/);
    expect(run).not.toHaveBeenCalled();
  });

  it("throws when the embedder returns no vector at all", async () => {
    const embed = jest.fn(() => Promise.resolve([]));
    const embeddings = { name: "x", dimensions: 4, embed } as unknown as EmbeddingProvider;
    const service = new VoiceService(
      embeddings,
      { run: jest.fn() } as unknown as RlsService,
      { record: jest.fn() } as unknown as UsageLogService,
      { info: jest.fn() } as unknown as StructuredLogger,
    );

    await expect(service.retrieveVoice(USER, QUERY)).rejects.toThrow(/0 dims, expected 4/);
  });
});
