import { PgExpertStore } from "./expert.store";
import type { Prisma } from "@expertos/db";

function makeTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const $queryRawUnsafe = jest.fn((sql: string, ...params: unknown[]) => {
    calls.push({ sql, params });
    return Promise.resolve(rows);
  });
  const tx = { $queryRawUnsafe } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

const EXPERT_ROWS = [
  { expert_id: "e1", display_name: "Dr. Lan", languages: ["en", "vi"] },
  { expert_id: "e2", display_name: "Mr. Quang", languages: ["en"] },
];

describe("PgExpertStore.listExperts", () => {
  it("lists active experts with a published profile, mapped to the meta shape", async () => {
    const { tx, calls } = makeTx(EXPERT_ROWS);
    const experts = await new PgExpertStore(tx).listExperts(undefined, 20);

    expect(experts).toEqual([
      { expertId: "e1", displayName: "Dr. Lan", languages: ["en", "vi"], hasActiveProfile: true },
      { expertId: "e2", displayName: "Mr. Quang", languages: ["en"], hasActiveProfile: true },
    ]);
    // Eligibility (active expert + published profile) is enforced in SQL, not in the caller.
    expect(calls[0].sql).toContain("e.active = true");
    expect(calls[0].sql).toContain("status = 'published'::publish_status");
    expect(calls[0].sql).toContain("array_agg(DISTINCT vp.language");
    expect(calls[0].sql).toContain("GROUP BY e.id, e.display_name");
    expect(calls[0].sql).toContain("ORDER BY e.display_name ASC");
    // No language filter when none requested; the only bound param is the limit at $1.
    expect(calls[0].sql).not.toContain("::language");
    expect(calls[0].params).toEqual([20]);
    expect(calls[0].sql).toContain("LIMIT $1");
  });

  it("adds a bound language filter and shifts the limit marker when a language is given", async () => {
    const { tx, calls } = makeTx([EXPERT_ROWS[0]]);
    await new PgExpertStore(tx).listExperts("vi", 5);

    // $1 = language (bound, cast to the enum), $2 = limit — never interpolated.
    expect(calls[0].sql).toContain("AND vp.language = $1::language");
    expect(calls[0].sql).toContain("LIMIT $2");
    expect(calls[0].params).toEqual(["vi", 5]);
  });

  it("treats a missing languages array as empty", async () => {
    const { tx } = makeTx([{ expert_id: "e3", display_name: "Solo", languages: null }]);
    const experts = await new PgExpertStore(tx).listExperts(undefined, 20);
    expect(experts[0].languages).toEqual([]);
  });
});
