import {
  AnthropicLlmProvider,
  EchoLlmProvider,
  GeminiLlmProvider,
  HashingEmbeddingProvider,
  OpenAiEmbeddingProvider,
  OpenAiLlmProvider,
} from "@expertos/ai";
import {
  createDefaultEmbeddingProvider,
  createDefaultLlmProvider,
  createDegradedLlmProvider,
} from "./ingestion.defaults";

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

describe("createDefaultEmbeddingProvider (env-gated, M17.6)", () => {
  it("uses the offline hashing embedder by default", () => {
    expect(createDefaultEmbeddingProvider({})).toBeInstanceOf(HashingEmbeddingProvider);
  });

  it("uses the OpenAI embedder when EMBEDDING_PROVIDER=openai and a key is set", () => {
    const provider = createDefaultEmbeddingProvider({
      EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(provider).toBeInstanceOf(OpenAiEmbeddingProvider);
    expect(provider.name).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });

  it("fails loudly when EMBEDDING_PROVIDER=openai but no key is configured", () => {
    expect(() => createDefaultEmbeddingProvider({ EMBEDDING_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("ignores an unrelated EMBEDDING_PROVIDER value and stays on hashing", () => {
    expect(
      createDefaultEmbeddingProvider({ EMBEDDING_PROVIDER: "vertex", OPENAI_API_KEY: "sk" }),
    ).toBeInstanceOf(HashingEmbeddingProvider);
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
