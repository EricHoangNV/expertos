/**
 * Voice-vs-facts separation tests (M2.4).
 *
 * These guard the product's core principle at the prompt-assembly boundary: the voice layer owns
 * tone/structure/framing and may NEVER add, drop, reorder, or alter a fact, and a claim that
 * lives only in a voice guideline or style example must never become a citable source. They
 * assert against {@link buildAnswerPrompt} output directly — the single enforcement point — rather
 * than re-implementing the rule. The eval harness (voice-harness.test.ts) layers a live-LLM
 * fidelity check on top.
 */

import { buildAnswerPrompt } from "./answer-prompt";
import type { AnswerPromptInput, PromptFact, VoiceProfileInput } from "./types";

const FACTS: PromptFact[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "The standard VAT rate is 10%." },
  { chunkId: "c2", documentVersionId: "dv2", content: "Returns are filed quarterly." },
];

const QUERY = "What is the VAT rate and how often do I file?";

const VOICE: VoiceProfileInput = {
  expertName: "Dr. Lan",
  // Note the decoy "37%": a number that exists ONLY in the voice guidelines, never in a source.
  guidelines: "Be direct. My old rule of thumb was a 37% margin, but always defer to the sources.",
};

const EXAMPLE_DECOY = "In 2019 the rate was 7%."; // a fact-shaped claim that lives only in an example

function build(input: Partial<AnswerPromptInput>) {
  return buildAnswerPrompt({ query: QUERY, facts: FACTS, ...input });
}

describe("voice-vs-facts separation", () => {
  it("keeps the citation list identical whether or not a voice is applied", () => {
    const neutral = build({});
    const voiced = build({ voice: VOICE });
    expect(voiced.citations).toEqual(neutral.citations);
    expect(voiced.citations).toEqual(FACTS);
  });

  it("keeps the citation list identical across different voices", () => {
    const a = build({ voice: { expertName: "Dr. Lan", guidelines: "Terse." } });
    const b = build({ voice: { expertName: "Mateo", guidelines: "Warm and narrative." } });
    expect(a.citations).toEqual(b.citations);
  });

  it("keeps the SOURCES+QUESTION user message byte-identical regardless of voice", () => {
    // Voice lives entirely in the system message; the facts the model grounds on must not move.
    const neutralUser = build({}).messages[1].content;
    const voicedUser = build({
      voice: VOICE,
      voiceExamples: [{ prompt: "older rate?", content: EXAMPLE_DECOY }],
    }).messages[1].content;
    expect(voicedUser).toBe(neutralUser);
  });

  it("never promotes a guideline-only or example-only number into the sources or citations", () => {
    const { messages, citations } = build({
      voice: VOICE,
      voiceExamples: [{ content: EXAMPLE_DECOY }],
    });
    const userMessage = messages[1].content;
    // The decoy numbers appear in the system framing (style) ...
    expect(messages[0].content).toContain("37%");
    expect(messages[0].content).toContain("7%");
    // ... but never leak into the SOURCES block the model is told to ground on ...
    expect(userMessage).not.toContain("37%");
    expect(userMessage).not.toContain("7%");
    // ... nor into the resolvable citation list.
    expect(citations.some((c) => c.content.includes("37%"))).toBe(false);
    expect(citations.some((c) => c.content.includes("7%"))).toBe(false);
  });

  it("confines all voice content to the system message, not the user/facts message", () => {
    const { messages } = build({
      voice: VOICE,
      voiceExamples: [{ prompt: "older rate?", content: EXAMPLE_DECOY }],
    });
    const [system, user] = messages;
    expect(system.content).toContain("37%");
    expect(system.content).toContain(EXAMPLE_DECOY);
    expect(user.content).not.toContain("37%");
    expect(user.content).not.toContain(EXAMPLE_DECOY);
  });

  it("states the facts-authoritative and voice-presentation-only rules even under a heavy voice", () => {
    const system = build({
      voice: VOICE,
      voiceExamples: Array.from({ length: 5 }, (_v, i) => ({ content: `style ${i}` })),
    }).messages[0].content;
    expect(system).toContain("FACTS ARE AUTHORITATIVE");
    expect(system).toContain("VOICE IS PRESENTATION ONLY");
    expect(system).toContain("INSUFFICIENT KNOWLEDGE");
  });
});
