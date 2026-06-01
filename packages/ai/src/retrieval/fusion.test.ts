import { fuseHybrid } from "./fusion";
import type { RankedChunk } from "./types";

function hit(id: string, score: number): RankedChunk {
  return { chunkId: id, documentVersionId: `dv-${id}`, content: `content ${id}`, score };
}

describe("fuseHybrid", () => {
  it("returns an empty list for a non-positive or non-finite topK", () => {
    expect(fuseHybrid([hit("a", 1)], [], 0)).toEqual([]);
    expect(fuseHybrid([hit("a", 1)], [], -3)).toEqual([]);
    expect(fuseHybrid([hit("a", 1)], [], Number.NaN)).toEqual([]);
  });

  it("merges a chunk found by both modalities and keeps both raw scores", () => {
    const vector = [hit("a", 0.9), hit("b", 0.5)];
    const keyword = [hit("a", 0.3), hit("c", 0.2)];

    const fused = fuseHybrid(vector, keyword, 10);

    const a = fused.find((c) => c.chunkId === "a");
    expect(a).toBeDefined();
    expect(a?.vectorScore).toBe(0.9);
    expect(a?.keywordScore).toBe(0.3);
    // a appears rank 1 in BOTH lists, so it outranks b and c (each in one list only).
    expect(fused[0].chunkId).toBe("a");
    expect(fused).toHaveLength(3);
  });

  it("carries provenance and leaves the absent modality score undefined", () => {
    const fused = fuseHybrid([hit("a", 0.7)], [hit("b", 0.4)], 10);
    const a = fused.find((c) => c.chunkId === "a");
    const b = fused.find((c) => c.chunkId === "b");
    expect(a?.documentVersionId).toBe("dv-a");
    expect(a?.keywordScore).toBeUndefined();
    expect(b?.vectorScore).toBeUndefined();
    expect(b?.keywordScore).toBe(0.4);
  });

  it("respects topK after fusion", () => {
    const fused = fuseHybrid([hit("a", 1), hit("b", 1), hit("c", 1)], [], 2);
    expect(fused).toHaveLength(2);
  });

  it("is deterministic on score ties via chunkId tiebreak", () => {
    // Same rank position in their respective single lists => equal RRF score.
    const fused = fuseHybrid([hit("b", 1)], [hit("a", 1)], 10);
    expect(fused.map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  it("applies modality weights so a heavier list ranks its top hit first", () => {
    const vector = [hit("v", 0.1)];
    const keyword = [hit("k", 0.1)];
    const fused = fuseHybrid(vector, keyword, 10, { vectorWeight: 5, keywordWeight: 1 });
    expect(fused[0].chunkId).toBe("v");
  });

  it("falls back to the default damping constant for an invalid k", () => {
    const withBadK = fuseHybrid([hit("a", 1)], [], 10, { k: 0 });
    const withDefault = fuseHybrid([hit("a", 1)], [], 10);
    expect(withBadK[0].score).toBeCloseTo(withDefault[0].score);
  });
});
