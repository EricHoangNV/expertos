/**
 * Voice-fidelity eval runner (M2.4).
 *
 * Two layers (see voice-types.ts):
 *  - **structural** — always run, pure, network-free: asserts the {@link buildAnswerPrompt}
 *    contract (disclosure, guidelines/examples injected & labeled style-only, separation rules,
 *    and the facts-invariant-under-voice guarantee). This is the CI regression guard.
 *  - **live** — run only when an {@link LlmProvider} and {@link VoiceJudge} are injected
 *    (out-of-band, like the retrieval harness's real embedder): generate the answer and score
 *    voice fidelity + fact adherence against the Open Decision #2 bars.
 */

import { buildAnswerPrompt } from "../prompt/answer-prompt";
import { aggregate, scoreLive, scoreStructural } from "./voice-metrics";
import type {
  VoiceCaseResult,
  VoiceEvalOptions,
  VoiceEvalReport,
  VoiceGoldenSet,
} from "./voice-types";

export async function evaluateVoice(
  goldenSet: VoiceGoldenSet,
  options: VoiceEvalOptions = {},
): Promise<VoiceEvalReport> {
  const { llm, judge } = options;
  if (judge && !llm) {
    throw new Error(
      "evaluateVoice: a `judge` requires an `llm` to generate answers to score.",
    );
  }
  // The live layer runs only when both are present.
  const live = Boolean(llm && judge);

  const results: VoiceCaseResult[] = [];
  for (const testCase of goldenSet.cases) {
    const structural = scoreStructural(testCase);
    const result: VoiceCaseResult = { caseId: testCase.id, structural };

    if (live && llm && judge) {
      const { messages } = buildAnswerPrompt({
        query: testCase.query,
        facts: testCase.facts,
        voice: testCase.voice,
        voiceExamples: testCase.voiceExamples,
        language: testCase.language,
      });
      const completion = await llm.complete(messages);
      const verdict = await judge.score({ case: testCase, answer: completion.text });
      result.live = scoreLive(verdict);
    }

    results.push(result);
  }

  return aggregate(results, live && judge ? judge.name : null);
}
