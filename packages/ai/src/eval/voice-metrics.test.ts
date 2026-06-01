import type { PromptFact } from "../prompt/types";
import {
  FACT_ADHERENCE_BAR,
  VOICE_FIDELITY_BAR,
  aggregate,
  scoreLive,
  scoreStructural,
} from "./voice-metrics";
import type { VoiceCaseResult, VoiceEvalCase } from "./voice-types";

const FACTS: PromptFact[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "The VAT rate is 10%." },
];

const FULL_CASE: VoiceEvalCase = {
  id: "full",
  query: "What is the VAT rate?",
  facts: FACTS,
  voice: { expertName: "Dr. Lan", guidelines: "Be direct. Lead with the number." },
  voiceExamples: [{ content: "Charge for value, not hours." }],
  expectStyleMarkers: ["Lead with the number", "Charge for value"],
};

describe("scoreStructural", () => {
  it("passes every check for a well-formed voiced case", () => {
    const r = scoreStructural(FULL_CASE);
    expect(r).toMatchObject({
      disclosurePresent: true,
      guidelinesPresent: true,
      examplesPresent: true,
      separationRulesPresent: true,
      factsInvariant: true,
      styleMarkersPresent: true,
      passed: true,
    });
    expect(r.score).toBe(1);
  });

  it("treats a voice with no expert name as missing its disclosure", () => {
    const r = scoreStructural({ ...FULL_CASE, voice: { expertName: "" } });
    expect(r.disclosurePresent).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(1);
  });

  it("marks guidelines absent when the voice has none", () => {
    const r = scoreStructural({
      id: "no-guidelines",
      query: "q",
      facts: FACTS,
      voice: { expertName: "Dr. Lan" },
    });
    expect(r.guidelinesPresent).toBe(false);
  });

  it("treats a case with no examples and no markers as vacuously satisfying both", () => {
    const r = scoreStructural({
      id: "bare",
      query: "q",
      facts: FACTS,
      voice: { expertName: "Dr. Lan", guidelines: "Be direct." },
    });
    expect(r.examplesPresent).toBe(true);
    expect(r.styleMarkersPresent).toBe(true);
  });

  it("flags examples that were capped out of the prompt as not present", () => {
    // The builder caps style examples at 5; a 6th example's content never reaches the prompt.
    const examples = Array.from({ length: 6 }, (_v, i) => ({ content: `unique-example-${i}` }));
    const r = scoreStructural({ ...FULL_CASE, voiceExamples: examples, expectStyleMarkers: [] });
    expect(r.examplesPresent).toBe(false);
  });

  it("flags a style marker that does not appear in the prompt", () => {
    const r = scoreStructural({ ...FULL_CASE, expectStyleMarkers: ["nowhere to be found"] });
    expect(r.styleMarkersPresent).toBe(false);
    expect(r.passed).toBe(false);
  });
});

describe("scoreLive", () => {
  it("passes when both bars are met", () => {
    expect(scoreLive({ voiceFidelity: 0.8, factAdherence: 1 }).passed).toBe(true);
  });

  it("fails when voice fidelity is below the bar", () => {
    expect(scoreLive({ voiceFidelity: VOICE_FIDELITY_BAR - 0.01, factAdherence: 1 }).passed).toBe(
      false,
    );
  });

  it("fails when fact adherence is below the bar", () => {
    expect(scoreLive({ voiceFidelity: 1, factAdherence: FACT_ADHERENCE_BAR - 0.01 }).passed).toBe(
      false,
    );
  });

  it("carries the verdict fields through", () => {
    const r = scoreLive({ voiceFidelity: 0.9, factAdherence: 1, rationale: "spot on" });
    expect(r.rationale).toBe("spot on");
    expect(r.voiceFidelity).toBe(0.9);
  });
});

describe("aggregate", () => {
  const structuralOnly: VoiceCaseResult[] = [
    { caseId: "a", structural: scoreStructural(FULL_CASE) },
    { caseId: "b", structural: scoreStructural({ ...FULL_CASE, id: "b", voice: { expertName: "" } }) },
  ];

  it("reports the structural mean and gate, and no live block without a judge", () => {
    const report = aggregate(structuralOnly, null);
    expect(report.live).toBeUndefined();
    expect(report.structuralPass).toBe(false); // case "b" fails
    expect(report.meanStructuralScore).toBeLessThan(1);
    expect(report.acceptance).toEqual({
      voiceFidelityBar: VOICE_FIDELITY_BAR,
      factAdherenceBar: FACT_ADHERENCE_BAR,
    });
  });

  it("passes the structural gate only when every case fully passes", () => {
    const allPass: VoiceCaseResult[] = [{ caseId: "a", structural: scoreStructural(FULL_CASE) }];
    expect(aggregate(allPass, null).structuralPass).toBe(true);
  });

  it("returns zeroed means and a failing gate for an empty case list", () => {
    const report = aggregate([], null);
    expect(report.meanStructuralScore).toBe(0);
    expect(report.structuralPass).toBe(false);
  });

  it("aggregates a passing live block when a judge ran", () => {
    const cases: VoiceCaseResult[] = [
      {
        caseId: "a",
        structural: scoreStructural(FULL_CASE),
        live: scoreLive({ voiceFidelity: 0.9, factAdherence: 1 }),
      },
    ];
    const report = aggregate(cases, "stub-judge");
    expect(report.live).toEqual({
      judge: "stub-judge",
      meanVoiceFidelity: 0.9,
      meanFactAdherence: 1,
      passed: true,
    });
  });

  it("fails the live gate when mean fidelity is below the bar", () => {
    const cases: VoiceCaseResult[] = [
      { caseId: "a", structural: scoreStructural(FULL_CASE), live: scoreLive({ voiceFidelity: 0.5, factAdherence: 1 }) },
    ];
    expect(aggregate(cases, "stub-judge").live?.passed).toBe(false);
  });

  it("fails the live gate when any case breaches fact adherence", () => {
    const cases: VoiceCaseResult[] = [
      { caseId: "a", structural: scoreStructural(FULL_CASE), live: scoreLive({ voiceFidelity: 0.95, factAdherence: 1 }) },
      { caseId: "b", structural: scoreStructural(FULL_CASE), live: scoreLive({ voiceFidelity: 0.95, factAdherence: 0.5 }) },
    ];
    expect(aggregate(cases, "stub-judge").live?.passed).toBe(false);
  });

  it("reports a failing live gate when the judge ran but produced no verdicts", () => {
    const report = aggregate([], "stub-judge");
    expect(report.live).toEqual({
      judge: "stub-judge",
      meanVoiceFidelity: 0,
      meanFactAdherence: 0,
      passed: false,
    });
  });
});
