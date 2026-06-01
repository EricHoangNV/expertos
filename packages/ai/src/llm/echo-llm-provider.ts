/**
 * Deterministic, offline LLM provider for seed/CLI, tests, and local dev (M3.1) — the
 * completion-side counterpart of {@link HashingEmbeddingProvider}. It produces a grounded
 * answer with no network or API key, derived only from the prompt the answer-builder emits, so
 * the chat pipeline (retrieve → voice → buildAnswerPrompt → generate → cite) is end-to-end
 * exercisable without a real model.
 *
 * It honours the product's load-bearing rules: it cites every numbered SOURCE the prompt
 * carries, and when the prompt has no sources it states the INSUFFICIENT-KNOWLEDGE answer
 * rather than inventing one (the M3.4 path). It is NOT a language model — it captures none of
 * the voice/semantics; the real OpenAI/Anthropic driver (same {@link LlmProvider} contract)
 * lands when network access is wired, swapped in one place via `createDefaultLlmProvider`.
 */

import type { ChatMessage, LlmCompletion, LlmProvider, LlmStreamChunk } from "../providers";
import { estimateTokens } from "../ingestion/chunk";

/** Returns the content of the last `user` message — the answer-builder's SOURCES + QUESTION block. */
function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return "";
}

/**
 * Pulls the question text and the count of distinct numbered sources out of the built user
 * prompt. The builder formats sources as `[1] …`, `[2] …` before a `QUESTION:` section.
 */
function parsePrompt(content: string): { question: string; sourceCount: number } {
  const marker = "QUESTION:";
  const qIdx = content.lastIndexOf(marker);
  const sourcesPart = qIdx >= 0 ? content.slice(0, qIdx) : content;
  const question = (qIdx >= 0 ? content.slice(qIdx + marker.length) : content).trim();
  const markers = sourcesPart.match(/\[(\d+)\]/g) ?? [];
  return { question, sourceCount: new Set(markers).size };
}

/** Builds the deterministic answer text for a set of messages. */
function render(messages: ChatMessage[]): string {
  const { question, sourceCount } = parsePrompt(lastUserContent(messages));
  const subject = question.length > 0 ? question : "your question";
  if (sourceCount === 0) {
    return `I don't have enough information in the provided sources to answer "${subject}".`;
  }
  const citations = Array.from({ length: sourceCount }, (_, i) => `[${i + 1}]`).join("");
  return `Based on the provided sources, here is what is known about "${subject}". ${citations}`;
}

function usageFor(messages: ChatMessage[], text: string): LlmCompletion["usage"] {
  return {
    promptTokens: estimateTokens(messages.map((m) => m.content).join("\n")),
    completionTokens: estimateTokens(text),
  };
}

export class EchoLlmProvider implements LlmProvider {
  readonly name: string;

  /**
   * @param name reported as the completion model (defaults to `echo-dev`). A distinct name lets a
   *   second instance stand in for a cheaper fair-use tier (M6.3) so the degraded model is
   *   observable in usage logs and tests, even though the offline echo output itself is identical.
   */
  constructor(name = "echo-dev") {
    this.name = name;
  }

  complete(messages: ChatMessage[]): Promise<LlmCompletion> {
    const text = render(messages);
    return Promise.resolve({ text, usage: usageFor(messages, text) });
  }

  async *completeStream(messages: ChatMessage[]): AsyncGenerator<LlmStreamChunk> {
    const text = render(messages);
    // Emit fixed-size slices so the concatenation of deltas is exactly `text` — the
    // streaming/non-streaming interchangeability the contract requires — with no edge case.
    const frame = 16;
    for (let i = 0; i < text.length; i += frame) {
      yield { delta: text.slice(i, i + frame) };
    }
    yield { usage: usageFor(messages, text) };
  }
}
