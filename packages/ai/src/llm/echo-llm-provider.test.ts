import { EchoLlmProvider } from "./echo-llm-provider";
import type { ChatMessage, LlmStreamChunk } from "../providers";

const SYSTEM: ChatMessage = { role: "system", content: "You are a knowledge assistant." };

function userPrompt(sources: string[], question: string): ChatMessage {
  const block =
    sources.length === 0
      ? "(no sources retrieved)"
      : sources.map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
  return { role: "user", content: `SOURCES:\n${block}\n\nQUESTION:\n${question}` };
}

async function collect(stream: AsyncIterable<LlmStreamChunk>) {
  const deltas: string[] = [];
  let usage: LlmStreamChunk["usage"];
  for await (const chunk of stream) {
    if (chunk.delta !== undefined) deltas.push(chunk.delta);
    if (chunk.usage) usage = chunk.usage;
  }
  return { text: deltas.join(""), usage };
}

describe("EchoLlmProvider", () => {
  const llm = new EchoLlmProvider();

  it("defaults its model name to echo-dev, overridable for a cheaper fair-use tier (M6.3)", () => {
    expect(new EchoLlmProvider().name).toBe("echo-dev");
    expect(new EchoLlmProvider("echo-dev-mini").name).toBe("echo-dev-mini");
  });

  it("cites every numbered source and echoes the question", async () => {
    const messages = [SYSTEM, userPrompt(["fact a", "fact b"], "how do I file taxes")];
    const { text, usage } = await llm.complete(messages);

    expect(text).toContain('"how do I file taxes"');
    expect(text).toContain("[1][2]");
    expect(text).not.toContain("[3]");
    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
  });

  it("states insufficient knowledge when there are no sources", async () => {
    const { text } = await llm.complete([SYSTEM, userPrompt([], "what is the meaning of life")]);
    expect(text).toMatch(/don't have enough information/i);
    expect(text).toContain('"what is the meaning of life"');
    expect(text).not.toContain("[1]");
  });

  it("is deterministic — same messages yield the same text", async () => {
    const messages = [SYSTEM, userPrompt(["x"], "q")];
    const a = await llm.complete(messages);
    const b = await llm.complete(messages);
    expect(a.text).toBe(b.text);
  });

  it("streams deltas that concatenate to exactly complete()'s text, with a terminal usage frame", async () => {
    const messages = [SYSTEM, userPrompt(["fact a", "fact b", "fact c"], "a longer question here")];
    const whole = await llm.complete(messages);
    const streamed = await collect(llm.completeStream(messages));

    expect(streamed.text).toBe(whole.text);
    expect(streamed.usage).toEqual(whole.usage);
  });

  it("falls back to a generic subject and insufficient-knowledge when no user message is present", async () => {
    const { text } = await llm.complete([SYSTEM]);
    expect(text).toContain('"your question"');
    expect(text).toMatch(/don't have enough information/i);
  });

  it("treats the whole user content as the question when there is no QUESTION marker", async () => {
    const { text } = await llm.complete([{ role: "user", content: "[1] a\n\njust some text" }]);
    // sourceCount counts the [1] marker, so it answers (not insufficient).
    expect(text).toContain("[1]");
    expect(text).toContain("just some text");
  });
});
