import { HashingEmbeddingProvider } from "../embedding/hashing-embedding-provider";
import { evaluateRetrieval } from "./harness";
import type { EvalGoldenSet } from "./types";

const TINY_SET: EvalGoldenSet = {
  documents: [
    { id: "pricing", content: "SaaS pricing tiers and per-seat plans for your product." },
    { id: "hiring", content: "Hiring engineers and running structured interviews." },
    { id: "security", content: "Rotate secrets and enforce least privilege access." },
  ],
  cases: [
    {
      id: "price",
      query: "how to set SaaS pricing tiers",
      relevantDocIds: ["pricing"],
    },
  ],
};

describe("evaluateRetrieval", () => {
  it("retrieves the lexically matching document at rank 1", async () => {
    const report = await evaluateRetrieval(TINY_SET);
    const result = report.cases[0];
    expect(result.retrievedDocIds[0]).toBe("pricing");
    expect(result.hit).toBe(true);
    expect(result.recallAtK).toBe(1);
    expect(result.reciprocalRank).toBe(1);
    expect(report.hitRate).toBe(1);
    expect(report.embedder).toBe("hashing-dev");
    expect(report.topK).toBe(8);
  });

  it("honors an explicit embedder, topK, and fusion options", async () => {
    const report = await evaluateRetrieval(TINY_SET, {
      embedder: new HashingEmbeddingProvider(256),
      topK: 2,
      fusion: { k: 30 },
    });
    expect(report.topK).toBe(2);
    // top-K caps the deduped doc list length.
    expect(report.cases[0].retrievedDocIds.length).toBeLessThanOrEqual(2);
    expect(report.cases[0].retrievedDocIds).toContain("pricing");
  });

  it("splits a long document into multiple chunks but scores at the document level", async () => {
    const longBody = Array.from({ length: 60 }, (_, i) => `alpha${i}`).join(" ");
    const set: EvalGoldenSet = {
      documents: [
        { id: "doc", content: `${longBody} pricing tiers` },
        { id: "other", content: "completely unrelated hiring interview content" },
      ],
      cases: [{ id: "q", query: "pricing tiers", relevantDocIds: ["doc"] }],
    };
    // Small window forces several chunks of "doc"; retrievedDocIds must still be deduped.
    const report = await evaluateRetrieval(set, { chunk: { maxTokens: 10, overlapTokens: 2 } });
    const ids = report.cases[0].retrievedDocIds;
    expect(ids).toContain("doc");
    expect(new Set(ids).size).toBe(ids.length); // deduped by document
    expect(report.cases[0].hit).toBe(true);
  });

  it("misses cross-lingual matches with the offline lexical embedder (documents the limitation)", async () => {
    // An English query shares no tokens with a Vietnamese-only document, and the lexical
    // hashing embedder cannot bridge languages — so among distractors the VI doc is not a hit.
    // The real multilingual model is what closes this gap; it is measured out-of-band.
    const set: EvalGoldenSet = {
      documents: [
        { id: "vi-pricing", language: "vi", content: "Định giá sản phẩm và các gói giá theo tháng." },
        { id: "en-hiring", language: "en", content: "Hiring engineers and structured interviews." },
        { id: "en-security", language: "en", content: "Rotate secrets and least privilege." },
        { id: "en-analytics", language: "en", content: "Funnel from signup to activation metrics." },
        { id: "en-fundraising", language: "en", content: "Seed round pitch deck and valuation cap." },
      ],
      cases: [
        {
          id: "x-lingual",
          language: "en",
          query: "how should I price my product across pricing tiers",
          relevantDocIds: ["vi-pricing"],
        },
      ],
    };
    const report = await evaluateRetrieval(set, { topK: 2 });
    expect(report.cases[0].hit).toBe(false);
    expect(report.hitRate).toBe(0);
  });
});
