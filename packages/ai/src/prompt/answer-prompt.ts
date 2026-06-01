/**
 * Voice-on-top-of-facts prompt builder (M2.1).
 *
 * It assembles the message array sent to the LLM so that an answer is rendered in an expert's
 * voice while the retrieved facts remain authoritative. The separation is the product's core
 * principle (PRD §"What this product is", #5): retrieval/citations own *facts*; the voice layer
 * owns *tone / structure / framing* and must never rewrite a cited number or claim. The system
 * message states that contract explicitly, labels the voice guidelines and style examples as
 * STYLE-ONLY, and pins the citation format so every claim is traceable to a numbered source.
 *
 * The builder is pure and deterministic (no clock / RNG / IO) so the M2.4 voice-vs-facts
 * separation tests and the citation-resolvability eval can assert against its output directly.
 */

import type { ChatMessage } from "../providers";
import { normalizeText } from "../text";
import type {
  AnswerPrompt,
  AnswerPromptInput,
  PromptFact,
  PromptLanguage,
  VoiceExampleInput,
} from "./types";

/** Cap on style examples injected, so the few-shot block can't crowd out the facts. */
const MAX_VOICE_EXAMPLES = 5;

const LANGUAGE_NAMES: Record<PromptLanguage, string> = {
  en: "English",
  vi: "Vietnamese",
};

/**
 * Builds the answer prompt. Returns the message array plus the citation-ordered source list:
 * a `[n]` marker in the model's answer resolves to `citations[n - 1]`.
 */
export function buildAnswerPrompt(input: AnswerPromptInput): AnswerPrompt {
  const language: PromptLanguage = input.language ?? "en";
  // Carry facts through verbatim as the citation index; the system prompt numbers them 1..N.
  const citations: PromptFact[] = [...input.facts];

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(input, language) },
    { role: "user", content: buildUserPrompt(input, citations) },
  ];

  return { messages, citations };
}

function buildSystemPrompt(
  input: AnswerPromptInput,
  language: PromptLanguage,
): string {
  const expert = input.voice?.expertName;
  const sections: string[] = [];

  sections.push(
    expert
      ? `You are an AI rendition of ${expert}, answering the user's question in ${expert}'s voice. You are not ${expert} and must never claim to be the real person or to have first-hand or real-time experience beyond the provided sources.`
      : `You are a knowledge assistant answering the user's question from the provided sources.`,
  );

  // The load-bearing rule: facts are authoritative, voice is presentation only.
  sections.push(
    [
      "Rules (in priority order):",
      "1. FACTS ARE AUTHORITATIVE. Answer ONLY using the numbered SOURCES in the user message. Do not use outside knowledge, and never invent, alter, round, or contradict any fact, number, name, date, or recommendation that appears in a source.",
      "2. CITE EVERYTHING. After every factual statement, add a citation marker [n] referencing the source it came from (e.g. [1], or [1][3] when it draws on several). Use only the source numbers provided.",
      "3. VOICE IS PRESENTATION ONLY. The voice guidelines and style examples below shape tone, structure, directness, terminology, and framing. They are NOT facts: never lift a claim, number, or recommendation out of them, and never let them override what the SOURCES say.",
      "4. INSUFFICIENT KNOWLEDGE. If the SOURCES do not contain enough to answer, say so plainly (in voice) and stop — do not fill the gap from memory or from the style examples.",
      `5. Write the answer in ${LANGUAGE_NAMES[language]}.`,
    ].join("\n"),
  );

  const guidelines = input.voice?.guidelines?.trim();
  if (guidelines) {
    sections.push(`Voice guidelines (style only):\n${normalizeText(guidelines)}`);
  }

  const examplesBlock = renderVoiceExamples(input.voiceExamples);
  if (examplesBlock) {
    sections.push(
      `Style examples — how ${expert ?? "the expert"} phrases things (mimic the STYLE, never the facts):\n${examplesBlock}`,
    );
  }

  if (expert) {
    sections.push(
      `Present the answer as an AI rendition of ${expert}. Do not append a separate disclaimer line — the UI surfaces the "AI rendition" label.`,
    );
  }

  return sections.join("\n\n");
}

function renderVoiceExamples(
  examples: VoiceExampleInput[] | undefined,
): string | null {
  if (!examples || examples.length === 0) {
    return null;
  }
  const rendered = examples
    .slice(0, MAX_VOICE_EXAMPLES)
    .map((example, index) => {
      const prompt = example.prompt?.trim();
      const header = prompt
        ? `Example ${index + 1} (Q: ${normalizeText(prompt)}):`
        : `Example ${index + 1}:`;
      return `${header}\n${normalizeText(example.content.trim())}`;
    });
  return rendered.join("\n\n");
}

function buildUserPrompt(
  input: AnswerPromptInput,
  citations: PromptFact[],
): string {
  const sources =
    citations.length === 0
      ? "(no sources retrieved)"
      : citations
          .map(
            (fact, index) => `[${index + 1}] ${normalizeText(fact.content.trim())}`,
          )
          .join("\n\n");

  return [`SOURCES:\n${sources}`, `QUESTION:\n${normalizeText(input.query.trim())}`].join(
    "\n\n",
  );
}
