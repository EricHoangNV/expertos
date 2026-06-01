import { buildAnswerPrompt } from "./answer-prompt";
import type { AnswerPromptInput, PromptFact } from "./types";

const FACTS: PromptFact[] = [
  { chunkId: "c1", documentVersionId: "dv1", content: "The standard VAT rate is 10%." },
  { chunkId: "c2", documentVersionId: "dv2", content: "Returns are filed quarterly." },
];

const BASE: AnswerPromptInput = {
  query: "What is the VAT rate?",
  facts: FACTS,
};

function systemOf(input: AnswerPromptInput): string {
  return buildAnswerPrompt(input).messages[0].content;
}
function userOf(input: AnswerPromptInput): string {
  return buildAnswerPrompt(input).messages[1].content;
}

describe("buildAnswerPrompt", () => {
  it("emits a system message then a user message", () => {
    const { messages } = buildAnswerPrompt(BASE);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("numbers sources and aligns the citation index to the [n] markers", () => {
    const { citations } = buildAnswerPrompt(BASE);
    const user = userOf(BASE);

    expect(user).toContain("[1] The standard VAT rate is 10%.");
    expect(user).toContain("[2] Returns are filed quarterly.");
    // citations[i] resolves marker [i+1] — the M4 resolvability contract.
    expect(citations).toEqual(FACTS);
    expect(citations[0].chunkId).toBe("c1");
  });

  it("includes the user question verbatim", () => {
    expect(userOf(BASE)).toContain("QUESTION:\nWhat is the VAT rate?");
  });

  it("states the facts-are-authoritative and citation rules even with no voice", () => {
    const system = systemOf(BASE);
    expect(system).toContain("FACTS ARE AUTHORITATIVE");
    expect(system).toContain("CITE EVERYTHING");
    expect(system).toContain("VOICE IS PRESENTATION ONLY");
    expect(system).toContain("INSUFFICIENT KNOWLEDGE");
  });

  it("omits the high-stakes scoping rule by default", () => {
    expect(systemOf(BASE)).not.toContain("HIGH-STAKES TOPIC");
  });

  it("adds the high-stakes educational-scope rule when flagged (NT.4)", () => {
    const system = systemOf({ ...BASE, highStakes: true });
    expect(system).toContain("HIGH-STAKES TOPIC");
    expect(system).toContain("educational context");
    // The model must not write its own disclaimer — the UI surfaces it.
    expect(system).toContain("the interface adds the disclaimer");
  });

  it("defaults to English and switches to Vietnamese when asked", () => {
    expect(systemOf(BASE)).toContain("Write the answer in English.");
    expect(systemOf({ ...BASE, language: "vi" })).toContain(
      "Write the answer in Vietnamese.",
    );
  });

  it("renders the AI-rendition framing when a voice profile is present", () => {
    const system = systemOf({
      ...BASE,
      voice: { expertName: "Dr. Lan", guidelines: "Be direct. Lead with the number." },
    });
    expect(system).toContain("AI rendition of Dr. Lan");
    expect(system).toContain("must never claim to be the real person");
    expect(system).toContain("Voice guidelines (style only):");
    expect(system).toContain("Be direct. Lead with the number.");
  });

  it("omits the rendition framing and guidelines block when no voice is given", () => {
    const system = systemOf(BASE);
    expect(system).toContain("knowledge assistant");
    expect(system).not.toContain("AI rendition of");
    expect(system).not.toContain("Voice guidelines");
  });

  it("labels voice examples as style-only and includes their content", () => {
    const system = systemOf({
      ...BASE,
      voice: { expertName: "Dr. Lan" },
      voiceExamples: [
        { prompt: "How should I price?", content: "Charge for value, not hours." },
        { content: "Always start with the customer's pain." },
      ],
    });
    expect(system).toContain("mimic the STYLE, never the facts");
    expect(system).toContain("Example 1 (Q: How should I price?):");
    expect(system).toContain("Charge for value, not hours.");
    expect(system).toContain("Example 2:");
    expect(system).toContain("Always start with the customer's pain.");
  });

  it("caps voice examples to keep facts from being crowded out", () => {
    const many = Array.from({ length: 9 }, (_v, i) => ({
      content: `style sample ${i}`,
    }));
    const system = systemOf({ ...BASE, voiceExamples: many });
    expect(system).toContain("style sample 4");
    expect(system).not.toContain("style sample 5");
  });

  it("still builds with no facts and yields an empty citation list", () => {
    const empty = { query: "anything?", facts: [] };
    const { citations } = buildAnswerPrompt(empty);
    expect(citations).toEqual([]);
    expect(userOf(empty)).toContain("(no sources retrieved)");
    // The insufficient-knowledge rule is what makes a no-source answer safe.
    expect(systemOf(empty)).toContain("INSUFFICIENT KNOWLEDGE");
  });

  it("NFC-normalizes facts, query, guidelines, and examples (VI recall safety)", () => {
    // Decomposed (NFD) "Việt" — combining marks that would shatter tokenization downstream.
    const nfd = "Việt";
    const nfc = nfd.normalize("NFC");
    const prompt = buildAnswerPrompt({
      query: nfd,
      facts: [{ chunkId: "c", documentVersionId: "d", content: nfd }],
      voice: { expertName: "X", guidelines: nfd },
      voiceExamples: [{ prompt: nfd, content: nfd }],
    });
    const all = prompt.messages.map((m) => m.content).join("\n");
    expect(all).toContain(nfc);
    expect(all).not.toContain(nfd);
  });
});
