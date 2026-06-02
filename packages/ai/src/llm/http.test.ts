import {
  LlmRequestError,
  StreamingLlmProvider,
  estimateUsage,
  readSseEvents,
  sseData,
} from "./http";
import type { ChatMessage, LlmStreamChunk } from "../providers";

/** Turns string chunks into the async byte stream `readSseEvents` consumes. */
function bytes(chunks: string[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    const enc = new TextEncoder();
    for (const c of chunks) yield enc.encode(c);
  })();
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const x of stream) out.push(x);
  return out;
}

describe("readSseEvents", () => {
  it("splits events on the blank-line boundary", async () => {
    expect(await collect(readSseEvents(bytes(["data: a\n\ndata: b\n\n"])))).toEqual([
      "data: a",
      "data: b",
    ]);
  });

  it("reassembles an event split across two byte chunks", async () => {
    expect(await collect(readSseEvents(bytes(["data: he", "llo\n\n"])))).toEqual(["data: hello"]);
  });

  it("emits a trailing event with no terminating blank line", async () => {
    expect(await collect(readSseEvents(bytes(["data: x\n\ndata: y"])))).toEqual([
      "data: x",
      "data: y",
    ]);
  });

  it("normalizes CRLF line endings", async () => {
    expect(await collect(readSseEvents(bytes(["data: a\r\n\r\n"])))).toEqual(["data: a"]);
  });
});

describe("sseData", () => {
  it("extracts the data payload", () => {
    expect(sseData('data: {"a":1}')).toBe('{"a":1}');
  });
  it("ignores non-data lines (e.g. Anthropic's event: line)", () => {
    expect(sseData("event: content_block_delta\ndata: hello")).toBe("hello");
  });
  it("passes through sentinels and returns null when there is no data line", () => {
    expect(sseData("data: [DONE]")).toBe("[DONE]");
    expect(sseData(": this is a comment")).toBeNull();
  });
});

describe("StreamingLlmProvider.complete", () => {
  class FakeStreaming extends StreamingLlmProvider {
    readonly name = "fake";
    constructor(private readonly frames: LlmStreamChunk[]) {
      super();
    }
    async *completeStream(): AsyncGenerator<LlmStreamChunk> {
      for (const f of this.frames) yield f;
    }
  }
  const q: ChatMessage[] = [{ role: "user", content: "question" }];

  it("concatenates deltas and surfaces the terminal usage frame", async () => {
    const provider = new FakeStreaming([
      { delta: "ab" },
      { delta: "cd" },
      { usage: { promptTokens: 7, completionTokens: 2 } },
    ]);
    const result = await provider.complete(q);
    expect(result.text).toBe("abcd");
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 2 });
  });

  it("estimates usage when the stream carries none (never silently zero)", async () => {
    const provider = new FakeStreaming([{ delta: "hello world" }]);
    const result = await provider.complete(q);
    expect(result.text).toBe("hello world");
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  });
});

describe("estimateUsage / LlmRequestError", () => {
  it("estimates non-zero usage from message + answer text", () => {
    const usage = estimateUsage([{ role: "user", content: "a b c d" }], "x y z");
    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
  });

  it("LlmRequestError carries provider + status in the message", () => {
    const err = new LlmRequestError("openai", 429, "rate limited");
    expect(err.status).toBe(429);
    expect(err.provider).toBe("openai");
    expect(err.message).toContain("openai");
    expect(err.message).toContain("429");
  });
});
