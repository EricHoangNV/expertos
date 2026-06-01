import { aggregate, scoreCase } from "./metrics";
import type { EvalCaseResult } from "./types";

describe("scoreCase", () => {
  it("scores a single relevant doc retrieved at rank 1 as a perfect hit", () => {
    expect(scoreCase(["a", "b", "c"], ["a"])).toEqual({
      hit: true,
      recallAtK: 1,
      precisionAtK: 1 / 3,
      reciprocalRank: 1,
    });
  });

  it("uses the rank of the FIRST relevant doc for reciprocal rank", () => {
    // 2 relevant total; one found at rank 3 of 4 retrieved.
    const result = scoreCase(["x", "y", "a", "z"], ["a", "b"]);
    expect(result.hit).toBe(true);
    expect(result.recallAtK).toBe(0.5);
    expect(result.precisionAtK).toBe(1 / 4);
    expect(result.reciprocalRank).toBeCloseTo(1 / 3);
  });

  it("returns all zeros when no relevant doc is retrieved", () => {
    expect(scoreCase(["x", "y"], ["a"])).toEqual({
      hit: false,
      recallAtK: 0,
      precisionAtK: 0,
      reciprocalRank: 0,
    });
  });

  it("guards an empty retrieved list (no NaN)", () => {
    expect(scoreCase([], ["a"])).toEqual({
      hit: false,
      recallAtK: 0,
      precisionAtK: 0,
      reciprocalRank: 0,
    });
  });

  it("guards an empty relevant set (no divide-by-zero)", () => {
    const result = scoreCase(["a", "b"], []);
    expect(result.recallAtK).toBe(0);
    expect(result.precisionAtK).toBe(0);
    expect(result.hit).toBe(false);
  });
});

describe("aggregate", () => {
  const caseResult = (over: Partial<EvalCaseResult>): EvalCaseResult => ({
    caseId: "c",
    hit: true,
    recallAtK: 1,
    precisionAtK: 1,
    reciprocalRank: 1,
    retrievedDocIds: [],
    ...over,
  });

  it("averages per-case metrics and reports the hit rate", () => {
    const report = aggregate(8, "hashing-dev", [
      caseResult({ hit: true, recallAtK: 1, precisionAtK: 0.5, reciprocalRank: 1 }),
      caseResult({ hit: false, recallAtK: 0, precisionAtK: 0, reciprocalRank: 0 }),
    ]);
    expect(report.hitRate).toBe(0.5);
    expect(report.meanRecallAtK).toBe(0.5);
    expect(report.meanPrecisionAtK).toBe(0.25);
    expect(report.mrr).toBe(0.5);
  });

  it("returns zeros for an empty case list", () => {
    const report = aggregate(8, "hashing-dev", []);
    expect(report).toMatchObject({
      topK: 8,
      embedder: "hashing-dev",
      hitRate: 0,
      meanRecallAtK: 0,
      meanPrecisionAtK: 0,
      mrr: 0,
    });
    expect(report.cases).toEqual([]);
  });
});
