import {
  AnthropicLlmProvider,
  EchoLlmProvider,
  GeminiLlmProvider,
  OpenAiLlmProvider,
} from "@expertos/ai";
import { createDefaultLlmProvider, createDegradedLlmProvider } from "./ingestion.defaults";

/** The factory reads keys/overrides from an injected env, so selection is testable without network. */
describe("createDefaultLlmProvider (env-based selection)", () => {
  it("falls back to the offline echo stub when no API key is configured", () => {
    const provider = createDefaultLlmProvider({});
    expect(provider).toBeInstanceOf(EchoLlmProvider);
    expect(provider.name).toBe("echo-dev");
  });

  it("uses OpenAI when OPENAI_API_KEY is set", () => {
    const provider = createDefaultLlmProvider({ OPENAI_API_KEY: "sk-test" });
    expect(provider).toBeInstanceOf(OpenAiLlmProvider);
    expect(provider.name).toBe("gpt-4o-mini");
  });

  it("honours LLM_MODEL as the model override", () => {
    const provider = createDefaultLlmProvider({ OPENAI_API_KEY: "sk-test", LLM_MODEL: "gpt-4o" });
    expect(provider.name).toBe("gpt-4o");
  });

  it("selects Anthropic when LLM_PROVIDER=anthropic and its key is present", () => {
    const provider = createDefaultLlmProvider({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "key",
    });
    expect(provider).toBeInstanceOf(AnthropicLlmProvider);
    expect(provider.name).toBe("claude-haiku-4-5");
  });

  it("selects Gemini when LLM_PROVIDER=gemini and its key is present", () => {
    const provider = createDefaultLlmProvider({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "key" });
    expect(provider).toBeInstanceOf(GeminiLlmProvider);
    expect(provider.name).toBe("gemini-1.5-flash");
  });

  it("falls back to echo when the explicitly-requested provider has no key", () => {
    const provider = createDefaultLlmProvider({ LLM_PROVIDER: "openai" });
    expect(provider).toBeInstanceOf(EchoLlmProvider);
  });

  it("prefers OpenAI when several keys are set and no provider is pinned", () => {
    const provider = createDefaultLlmProvider({
      OPENAI_API_KEY: "sk",
      ANTHROPIC_API_KEY: "key",
      GEMINI_API_KEY: "key",
    });
    expect(provider).toBeInstanceOf(OpenAiLlmProvider);
  });
});

describe("createDegradedLlmProvider (fair-use mini tier)", () => {
  it("falls back to the echo-dev-mini stub with no key", () => {
    const provider = createDegradedLlmProvider({});
    expect(provider).toBeInstanceOf(EchoLlmProvider);
    expect(provider.name).toBe("echo-dev-mini");
  });

  it("reads LLM_MODEL_MINI for the degraded model when a key is configured", () => {
    const provider = createDegradedLlmProvider({
      OPENAI_API_KEY: "sk-test",
      LLM_MODEL_MINI: "gpt-4o-mini",
    });
    expect(provider).toBeInstanceOf(OpenAiLlmProvider);
    expect(provider.name).toBe("gpt-4o-mini");
  });
});
