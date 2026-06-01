import { evaluateRecommendation } from "./evaluate";
import type { RecommendationRule, RecommendationSignals } from "./types";

/** A baseline "nothing notable" turn — overridden per test. */
function signals(overrides: Partial<RecommendationSignals> = {}): RecommendationSignals {
  return {
    question: "What is a good morning routine?",
    answer: "Wake early, hydrate, and plan your day. [1]",
    citationCount: 1,
    insufficientKnowledge: false,
    assistantTurnCount: 1,
    ...overrides,
  };
}

function rule(overrides: Partial<RecommendationRule> & Pick<RecommendationRule, "trigger">): RecommendationRule {
  return {
    enabled: true,
    threshold: null,
    keywords: [],
    priority: 0,
    consultationTypeKey: null,
    ...overrides,
  };
}

describe("evaluateRecommendation", () => {
  it("returns null when no rule fires", () => {
    const rules = [
      rule({ trigger: "high_intent", keywords: ["hire", "book"] }),
      rule({ trigger: "depth", threshold: 5 }),
      rule({ trigger: "low_confidence", threshold: 0 }),
    ];
    expect(evaluateRecommendation(signals(), rules)).toBeNull();
  });

  it("fires high_intent on a whole-word match in the question, carrying the matched keyword", () => {
    const out = evaluateRecommendation(
      signals({ question: "Can I hire you for a project?" }),
      [rule({ trigger: "high_intent", keywords: ["hire", "book"], consultationTypeKey: "intro_call" })],
    );
    expect(out).toEqual({ trigger: "high_intent", consultationTypeKey: "intro_call", matchedKeyword: "hire" });
  });

  it("matches a multi-word phrase as a contiguous run", () => {
    const out = evaluateRecommendation(
      signals({ question: "I would love to work with you on this." }),
      [rule({ trigger: "high_intent", keywords: ["work with you"] })],
    );
    expect(out?.matchedKeyword).toBe("work with you");
  });

  it("does NOT match a keyword embedded inside a larger word (whole-word boundary)", () => {
    const out = evaluateRecommendation(
      signals({ question: "How do I improve my syntax?" }),
      [rule({ trigger: "high_intent", keywords: ["tax"] })],
    );
    expect(out).toBeNull();
  });

  it("topic matches in the answer text, not just the question", () => {
    const out = evaluateRecommendation(
      signals({ question: "How should I structure this?", answer: "This may have legal implications. [1]" }),
      [rule({ trigger: "topic", keywords: ["legal", "tax"] })],
    );
    expect(out).toEqual({ trigger: "topic", consultationTypeKey: null, matchedKeyword: "legal" });
  });

  it("high_intent does NOT match a term that appears only in the answer", () => {
    const out = evaluateRecommendation(
      signals({ question: "Tell me about routines.", answer: "You could hire a coach. [1]" }),
      [rule({ trigger: "high_intent", keywords: ["hire"] })],
    );
    expect(out).toBeNull();
  });

  it("fires depth when the assistant-turn count reaches the threshold", () => {
    const r = [rule({ trigger: "depth", threshold: 3 })];
    expect(evaluateRecommendation(signals({ assistantTurnCount: 2 }), r)).toBeNull();
    expect(evaluateRecommendation(signals({ assistantTurnCount: 3 }), r)?.trigger).toBe("depth");
    expect(evaluateRecommendation(signals({ assistantTurnCount: 9 }), r)?.trigger).toBe("depth");
  });

  it("an unconfigured depth threshold (null / ≤ 0) never fires", () => {
    expect(evaluateRecommendation(signals({ assistantTurnCount: 50 }), [rule({ trigger: "depth", threshold: null })])).toBeNull();
    expect(evaluateRecommendation(signals({ assistantTurnCount: 50 }), [rule({ trigger: "depth", threshold: 0 })])).toBeNull();
  });

  it("fires low_confidence on the insufficient-knowledge path regardless of citation count", () => {
    const out = evaluateRecommendation(
      signals({ insufficientKnowledge: true, citationCount: 0 }),
      [rule({ trigger: "low_confidence", threshold: 0 })],
    );
    expect(out?.trigger).toBe("low_confidence");
  });

  it("fires low_confidence when citations are at or below the threshold", () => {
    const r = [rule({ trigger: "low_confidence", threshold: 1 })];
    expect(evaluateRecommendation(signals({ citationCount: 1 }), r)?.trigger).toBe("low_confidence");
    expect(evaluateRecommendation(signals({ citationCount: 2 }), r)).toBeNull();
  });

  it("skips disabled rules entirely", () => {
    const out = evaluateRecommendation(
      signals({ question: "Can I hire you?" }),
      [rule({ trigger: "high_intent", keywords: ["hire"], enabled: false })],
    );
    expect(out).toBeNull();
  });

  it("ignores empty / whitespace-only keywords", () => {
    const out = evaluateRecommendation(
      signals({ question: "A normal question." }),
      [rule({ trigger: "topic", keywords: ["", "   "] })],
    );
    expect(out).toBeNull();
  });

  it("surfaces the highest-priority rule when several fire", () => {
    const out = evaluateRecommendation(
      signals({ question: "Can I hire you for tax advice?", insufficientKnowledge: true }),
      [
        rule({ trigger: "low_confidence", threshold: 0, priority: 10 }),
        rule({ trigger: "high_intent", keywords: ["hire"], priority: 50 }),
        rule({ trigger: "topic", keywords: ["tax"], priority: 30 }),
      ],
    );
    expect(out?.trigger).toBe("high_intent");
  });

  it("breaks a priority tie by the declared trigger order (topic < depth < low_confidence < high_intent)", () => {
    const out = evaluateRecommendation(
      signals({ question: "Can I hire you for tax advice?" }),
      [
        rule({ trigger: "high_intent", keywords: ["hire"], priority: 5 }),
        rule({ trigger: "topic", keywords: ["tax"], priority: 5 }),
      ],
    );
    // Equal priority → the earlier-declared trigger (topic) wins deterministically.
    expect(out?.trigger).toBe("topic");
  });

  it("NFC-normalizes both sides so a decomposed Vietnamese question still matches an NFC keyword", () => {
    // "Việt" composed in the keyword, decomposed (NFD) in the question.
    const decomposed = "Toi muon hoi ve Việt Nam".normalize("NFD");
    const out = evaluateRecommendation(
      signals({ question: decomposed }),
      [rule({ trigger: "topic", keywords: ["việt"] })],
    );
    expect(out?.trigger).toBe("topic");
  });
});
