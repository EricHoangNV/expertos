import type { ChatMessage, LlmCompletion, LlmProvider } from "../providers";
import { evaluateVoice } from "./voice-harness";
import { VOICE_GOLDEN_SET } from "./voice-golden-set";
import type { VoiceGoldenSet, VoiceJudge, VoiceJudgeRequest } from "./voice-types";

/** Records the messages it was asked to complete so we can assert the prompt was wired through. */
class StubLlm implements LlmProvider {
  readonly name = "stub-llm";
  readonly seen: ChatMessage[][] = [];
  async complete(messages: ChatMessage[]): Promise<LlmCompletion> {
    this.seen.push(messages);
    return { text: "answer in voice", usage: { promptTokens: 1, completionTokens: 1 } };
  }
}

/** A judge that returns a verdict computed from the request, so we can vary it per case. */
class StubJudge implements VoiceJudge {
  readonly name = "stub-judge";
  readonly seen: VoiceJudgeRequest[] = [];
  constructor(private readonly verdictFor: (req: VoiceJudgeRequest) => { voiceFidelity: number; factAdherence: number }) {}
  async score(req: VoiceJudgeRequest) {
    this.seen.push(req);
    return this.verdictFor(req);
  }
}

describe("evaluateVoice", () => {
  it("runs the structural layer over the seed golden set with no live block", async () => {
    const report = await evaluateVoice(VOICE_GOLDEN_SET);
    expect(report.live).toBeUndefined();
    expect(report.cases).toHaveLength(VOICE_GOLDEN_SET.cases.length);
    // Every seed case is well-formed, so the offline structural gate passes.
    expect(report.structuralPass).toBe(true);
    expect(report.meanStructuralScore).toBe(1);
  });

  it("throws when a judge is supplied without an llm to generate answers", async () => {
    const judge = new StubJudge(() => ({ voiceFidelity: 1, factAdherence: 1 }));
    await expect(evaluateVoice(VOICE_GOLDEN_SET, { judge })).rejects.toThrow(/requires an `llm`/);
  });

  it("ignores a lone llm (no judge means no live scoring)", async () => {
    const llm = new StubLlm();
    const report = await evaluateVoice(VOICE_GOLDEN_SET, { llm });
    expect(report.live).toBeUndefined();
    // Without a judge the harness does not bother generating answers.
    expect(llm.seen).toHaveLength(0);
  });

  it("runs the live layer, feeding the built prompt to the llm and the answer to the judge", async () => {
    const llm = new StubLlm();
    const judge = new StubJudge(() => ({ voiceFidelity: 0.9, factAdherence: 1 }));
    const report = await evaluateVoice(VOICE_GOLDEN_SET, { llm, judge });

    // One generation + one judgement per case.
    expect(llm.seen).toHaveLength(VOICE_GOLDEN_SET.cases.length);
    expect(judge.seen).toHaveLength(VOICE_GOLDEN_SET.cases.length);
    // The llm was handed the actual voice-on-top-of-facts prompt (system + user).
    expect(llm.seen[0].map((m) => m.role)).toEqual(["system", "user"]);
    expect(llm.seen[0][0].content).toContain("FACTS ARE AUTHORITATIVE");
    // The judge scored the generated answer.
    expect(judge.seen[0].answer).toBe("answer in voice");

    expect(report.live).toMatchObject({
      judge: "stub-judge",
      meanVoiceFidelity: 0.9,
      meanFactAdherence: 1,
      passed: true,
    });
    expect(report.cases[0].live).toMatchObject({ voiceFidelity: 0.9, passed: true });
  });

  it("fails the live gate when a case's answer drifts off the facts", async () => {
    const llm = new StubLlm();
    // First case adheres, the rest invent — any breach of the fact-adherence bar fails the gate.
    const judge = new StubJudge((req) =>
      req.case.id === VOICE_GOLDEN_SET.cases[0].id
        ? { voiceFidelity: 0.95, factAdherence: 1 }
        : { voiceFidelity: 0.95, factAdherence: 0.4 },
    );
    const report = await evaluateVoice(VOICE_GOLDEN_SET, { llm, judge });
    expect(report.live?.passed).toBe(false);
  });

  it("clamps means and the gate correctly for an empty golden set under a live run", async () => {
    const empty: VoiceGoldenSet = { cases: [] };
    const report = await evaluateVoice(empty, {
      llm: new StubLlm(),
      judge: new StubJudge(() => ({ voiceFidelity: 1, factAdherence: 1 })),
    });
    expect(report.structuralPass).toBe(false);
    expect(report.live).toMatchObject({ meanVoiceFidelity: 0, passed: false });
  });
});
