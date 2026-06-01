import { evaluateRetrieval } from "./harness";
import { RETRIEVAL_GOLDEN_SET } from "./golden-set";

describe("RETRIEVAL_GOLDEN_SET", () => {
  it("every case has a unique id and at least one relevant document that exists", () => {
    const docIds = new Set(RETRIEVAL_GOLDEN_SET.documents.map((d) => d.id));
    const caseIds = new Set<string>();
    for (const testCase of RETRIEVAL_GOLDEN_SET.cases) {
      expect(caseIds.has(testCase.id)).toBe(false);
      caseIds.add(testCase.id);
      expect(testCase.relevantDocIds.length).toBeGreaterThan(0);
      for (const id of testCase.relevantDocIds) {
        expect(docIds.has(id)).toBe(true);
      }
    }
  });

  it("retrieves the intended document for every EN/VI/mixed case (deterministic, offline)", async () => {
    const report = await evaluateRetrieval(RETRIEVAL_GOLDEN_SET);
    const misses = report.cases.filter((c) => !c.hit).map((c) => c.caseId);
    expect(misses).toEqual([]);
    expect(report.hitRate).toBe(1);
    expect(report.meanRecallAtK).toBe(1); // exactly one relevant doc per case, always retrieved
  });

  it("retrieves an NFD-form Vietnamese query identically to its NFC twin (OD#9 regression guard)", async () => {
    const report = await evaluateRetrieval(RETRIEVAL_GOLDEN_SET);
    const byId = new Map(report.cases.map((c) => [c.caseId, c]));
    const nfc = byId.get("vi-pricing-nfc");
    const nfd = byId.get("vi-pricing-nfd");

    expect(nfd?.hit).toBe(true);
    // Decomposed and composed queries must produce the same ranked result.
    expect(nfd?.retrievedDocIds).toEqual(nfc?.retrievedDocIds);
  });
});
