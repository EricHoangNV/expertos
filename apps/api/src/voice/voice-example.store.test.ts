import { PgVoiceExampleStore } from "./voice-example.store";
import type { Prisma } from "@expertos/db";

function makeTx(profileRows: unknown[], exampleRows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const $queryRawUnsafe = jest.fn((sql: string, ...params: unknown[]) => {
    calls.push({ sql, params });
    return Promise.resolve(sql.includes("voice_profiles") ? profileRows : exampleRows);
  });
  const tx = { $queryRawUnsafe } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

const PROFILE_ROW = {
  voice_profile_id: "vp1",
  expert_name: "Dr. Lan",
  guidelines: "Be direct.",
};
const EXAMPLE_ROWS = [
  { id: "ve1", prompt: "How to price?", content: "Charge for value.", score: 0.91 },
  { id: "ve2", prompt: null, content: "Lead with the pain.", score: 0.77 },
];

describe("PgVoiceExampleStore.loadProfile", () => {
  it("returns the published profile mapped to the meta shape", async () => {
    const { tx, calls } = makeTx([PROFILE_ROW], []);
    const profile = await new PgVoiceExampleStore(tx).loadProfile("e1", "en");

    expect(profile).toEqual({
      voiceProfileId: "vp1",
      expertName: "Dr. Lan",
      guidelines: "Be direct.",
    });
    // Only published profiles of active experts are eligible; values are bound, not interpolated.
    expect(calls[0].sql).toContain("status = 'published'::publish_status");
    expect(calls[0].sql).toContain("e.active = true");
    expect(calls[0].params).toEqual(["e1", "en"]);
  });

  it("returns null when the expert has no published profile in that language", async () => {
    const { tx } = makeTx([], []);
    expect(await new PgVoiceExampleStore(tx).loadProfile("e1", "vi")).toBeNull();
  });
});

describe("PgVoiceExampleStore.retrieveExamples", () => {
  it("runs a cosine query scoped to the profile and maps scores to numbers", async () => {
    const { tx, calls } = makeTx([], EXAMPLE_ROWS);
    const hits = await new PgVoiceExampleStore(tx).retrieveExamples({
      voiceProfileId: "vp1",
      embedding: [0.1, 0.2, 0.3],
      topK: 3,
    });

    expect(hits).toEqual([
      { id: "ve1", prompt: "How to price?", content: "Charge for value.", score: 0.91 },
      { id: "ve2", prompt: null, content: "Lead with the pain.", score: 0.77 },
    ]);
    const call = calls[0];
    expect(call.sql).toContain("voice_profile_id = $2::uuid");
    expect(call.sql).toContain("embedding IS NOT NULL");
    // $1 = vector literal, $2 = profile id, $3 = topK limit.
    expect(call.params[0]).toBe("[0.10000000,0.20000000,0.30000000]");
    expect(call.params[1]).toBe("vp1");
    expect(call.params[2]).toBe(3);
  });
});
