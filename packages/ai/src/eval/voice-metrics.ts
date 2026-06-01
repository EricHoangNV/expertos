/**
 * Pure scoring for the voice-fidelity eval (M2.4). All aggregates guard against an empty case
 * list (directive §9 — guard NaN/Infinity), and the acceptance bars resolve Open Decision #2.
 */

import { buildAnswerPrompt } from "../prompt/answer-prompt";
import { buildAttribution } from "../prompt/attribution";
import { normalizeText } from "../text";
import type {
  LiveVoiceResult,
  StructuralVoiceResult,
  VoiceCaseResult,
  VoiceEvalCase,
  VoiceEvalReport,
  VoiceJudgeVerdict,
} from "./voice-types";

/**
 * Open Decision #2 — the voice-fidelity acceptance bar, taken as an engineering stance:
 *
 *  - **Fact adherence is non-negotiable: 1.0.** The product's premise is that facts stay
 *    authoritative, so any invented/altered claim fails the case outright. The structural layer
 *    already proves the prompt cannot leak example claims into the source set; this bar holds the
 *    *generated answer* to the same standard on the live layer.
 *  - **Voice fidelity ≥ 0.7 (mean).** Voice is a spectrum, not a boolean: a 0.7 mean means the
 *    rendering is recognizably the expert most of the time while leaving headroom for judge
 *    noise. Tighten once the live golden set and judge are calibrated against expert sign-off
 *    (the open half of OD#2 — the *product* acceptance bar — and OD#6 golden-set ownership).
 */
export const VOICE_FIDELITY_BAR = 0.7;
export const FACT_ADHERENCE_BAR = 1.0;

/**
 * Structural voice-fidelity checks for one case, asserted against the built prompt. The key
 * invariant is {@link StructuralVoiceResult.factsInvariant}: building the same facts with vs.
 * without the voice must yield an identical user message (SOURCES + QUESTION) and citation list —
 * voice shapes only the system framing, never the facts.
 */
export function scoreStructural(testCase: VoiceEvalCase): StructuralVoiceResult {
  const withVoice = buildAnswerPrompt({
    query: testCase.query,
    facts: testCase.facts,
    voice: testCase.voice,
    voiceExamples: testCase.voiceExamples,
    language: testCase.language,
  });
  // Voice-off twin: same facts/query/language, no voice layer at all.
  const withoutVoice = buildAnswerPrompt({
    query: testCase.query,
    facts: testCase.facts,
    language: testCase.language,
  });

  const system = withVoice.messages[0].content;
  const attribution = buildAttribution(testCase.voice);

  const disclosurePresent =
    attribution.disclosureText !== "" && system.includes(attribution.disclosureText);

  const guidelines = testCase.voice.guidelines?.trim();
  const guidelinesPresent = guidelines
    ? system.includes(normalizeText(guidelines))
    : false;

  const examples = testCase.voiceExamples ?? [];
  const examplesPresent = examples.every((example) =>
    system.includes(normalizeText(example.content.trim())),
  );

  const separationRulesPresent =
    system.includes("FACTS ARE AUTHORITATIVE") &&
    system.includes("VOICE IS PRESENTATION ONLY");

  // The core guarantee: facts untouched by voice. Compare the whole user message (SOURCES +
  // QUESTION) and the citation list against the voice-off build. The citation list is a flat
  // array of flat records, so a stable JSON compare is an exact deep-equality check here.
  const factsInvariant =
    withVoice.messages[1].content === withoutVoice.messages[1].content &&
    JSON.stringify(withVoice.citations) === JSON.stringify(withoutVoice.citations);

  const markers = testCase.expectStyleMarkers ?? [];
  const styleMarkersPresent = markers.every((marker) =>
    system.includes(normalizeText(marker)),
  );

  const checks = [
    disclosurePresent,
    guidelinesPresent,
    examplesPresent,
    separationRulesPresent,
    factsInvariant,
    styleMarkersPresent,
  ];
  const score = checks.filter(Boolean).length / checks.length;

  return {
    disclosurePresent,
    guidelinesPresent,
    examplesPresent,
    separationRulesPresent,
    factsInvariant,
    styleMarkersPresent,
    score,
    passed: score === 1,
  };
}

/** Wrap a live judge verdict with whether it clears the per-case acceptance bars. */
export function scoreLive(verdict: VoiceJudgeVerdict): LiveVoiceResult {
  return {
    ...verdict,
    passed:
      verdict.voiceFidelity >= VOICE_FIDELITY_BAR &&
      verdict.factAdherence >= FACT_ADHERENCE_BAR,
  };
}

/** Aggregate per-case results into the report-level means and pass gates. */
export function aggregate(
  cases: VoiceCaseResult[],
  judgeName: string | null,
): VoiceEvalReport {
  const report: VoiceEvalReport = {
    cases,
    meanStructuralScore: mean(cases.map((c) => c.structural.score)),
    structuralPass: cases.length > 0 && cases.every((c) => c.structural.passed),
    acceptance: {
      voiceFidelityBar: VOICE_FIDELITY_BAR,
      factAdherenceBar: FACT_ADHERENCE_BAR,
    },
  };

  if (judgeName !== null) {
    const live = cases.map((c) => c.live).filter((l): l is LiveVoiceResult => Boolean(l));
    const meanVoiceFidelity = mean(live.map((l) => l.voiceFidelity));
    report.live = {
      judge: judgeName,
      meanVoiceFidelity,
      meanFactAdherence: mean(live.map((l) => l.factAdherence)),
      passed:
        live.length > 0 &&
        meanVoiceFidelity >= VOICE_FIDELITY_BAR &&
        live.every((l) => l.factAdherence >= FACT_ADHERENCE_BAR),
    };
  }

  return report;
}

/** Mean of `values`, or 0 for an empty list. */
function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}
