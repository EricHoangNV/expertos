import {
  extractiveSummary,
  ExtractiveSummarizer,
  LlmSummarizer,
} from "./summarize";
import type { ChatMessage, LlmCompletion, LlmProvider } from "../providers";

describe("extractiveSummary", () => {
  it("returns empty string for empty / whitespace text", () => {
    expect(extractiveSummary("")).toBe("");
    expect(extractiveSummary("   \n ")).toBe("");
  });

  it("keeps the leading sentences up to the sentence cap", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    expect(extractiveSummary(text, { maxSentences: 2 })).toBe(
      "First sentence. Second sentence.",
    );
  });

  it("collapses whitespace", () => {
    expect(extractiveSummary("Hello   world.\n\nNext.", { maxSentences: 1 })).toBe(
      "Hello world.",
    );
  });

  it("stops before exceeding the char cap", () => {
    const text = "Short one. A considerably longer second sentence here.";
    expect(extractiveSummary(text, { maxSentences: 5, maxChars: 12 })).toBe("Short one.");
  });

  it("hard-truncates a first sentence that already exceeds the char cap", () => {
    const text = "An extremely long opening sentence with no early terminator at all.";
    const summary = extractiveSummary(text, { maxChars: 10 });
    expect(summary.length).toBeLessThanOrEqual(10);
    expect(text.startsWith(summary)).toBe(true);
  });

  it("handles text with no sentence terminator", () => {
    expect(extractiveSummary("no terminator here", { maxChars: 100 })).toBe(
      "no terminator here",
    );
  });

  it("returns empty string when the text is only terminators", () => {
    expect(extractiveSummary("...!?")).toBe("");
  });
});

describe("ExtractiveSummarizer", () => {
  it("resolves to the extractive summary", async () => {
    const summarizer = new ExtractiveSummarizer({ maxSentences: 1 });
    await expect(summarizer.summarize("One. Two.")).resolves.toBe("One.");
  });

  it("uses defaults when no options are given", async () => {
    const summarizer = new ExtractiveSummarizer();
    await expect(summarizer.summarize("One. Two. Three.")).resolves.toBe("One. Two.");
  });
});

describe("LlmSummarizer", () => {
  it("short-circuits empty input without calling the model", async () => {
    const llm: LlmProvider = {
      name: "fake",
      complete: jest.fn(),
    };
    await expect(new LlmSummarizer(llm).summarize("  ")).resolves.toBe("");
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it("prompts the model with the word budget and trims the response", async () => {
    let captured: ChatMessage[] = [];
    const llm: LlmProvider = {
      name: "fake",
      complete: (messages): Promise<LlmCompletion> => {
        captured = messages;
        return Promise.resolve({ text: "  a tidy summary  ", usage: { promptTokens: 5, completionTokens: 3 } });
      },
    };
    const out = await new LlmSummarizer(llm, 25).summarize("a long passage");
    expect(out).toBe("a tidy summary");
    expect(captured[0].role).toBe("system");
    expect(captured[0].content).toContain("25 words");
    expect(captured[1]).toEqual({ role: "user", content: "a long passage" });
  });
});
