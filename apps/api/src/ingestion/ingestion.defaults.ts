/**
 * Single source of truth for the M1.1 ingestion pipeline's default (offline,
 * deterministic) parts. Shared by {@link IngestionModule} (DI) and the seed/CLI loader
 * so the two composition roots can't drift in which parsers/providers they use.
 *
 * When a production embedding/LLM driver is introduced, override it here (and behind the
 * `EMBEDDING_PROVIDER` / `SUMMARIZER` DI tokens) so both the running API and the CLI seed
 * loader write vectors from the same model into the same vector space.
 */
import {
  AnthropicLlmProvider,
  EchoLlmProvider,
  ExtractiveSummarizer,
  GeminiLlmProvider,
  HashingEmbeddingProvider,
  OpenAiEmbeddingProvider,
  OpenAiLlmProvider,
  type EmbeddingProvider,
  type LlmProvider,
  type Summarizer,
} from "@expertos/ai";
import { ParserRegistry } from "./parser-registry";
import { TextParser } from "./parsers/text-parser";
import { CsvParser } from "./parsers/csv-parser";
import { XlsxParser } from "./parsers/xlsx-parser";

export function createDefaultParserRegistry(): ParserRegistry {
  return new ParserRegistry([new TextParser(), new CsvParser(), new XlsxParser()]);
}

/**
 * Default embedding provider (M1.1 / M17.6). Opt-in to the real OpenAI embedder
 * (`text-embedding-3-small`, 1536-dim) via `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY`; otherwise
 * the offline, deterministic {@link HashingEmbeddingProvider} (dev/seed/CI). This is the single swap
 * point shared by ingestion DI, retrieval, voice/concierge matching, and the re-embed CLI, so chunk
 * vectors and the query vector are always produced by the same model (same vector space).
 *
 * Switching embedders is **env + restart, not a live toggle** — existing vectors become incompatible,
 * so a cutover sets the env, restarts, and runs the re-embed CLI. We fail loudly when the flag is set
 * without a key rather than silently writing hashing vectors into what is meant to be the OpenAI space.
 */
export function createDefaultEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER?.trim().toLowerCase() === "openai") {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY; set the key or unset EMBEDDING_PROVIDER to use the dev hashing embedder.",
      );
    }
    return new OpenAiEmbeddingProvider({ apiKey });
  }
  return new HashingEmbeddingProvider();
}

export function createDefaultSummarizer(): Summarizer {
  return new ExtractiveSummarizer();
}

/** Default model id per provider when neither `LLM_MODEL`/`LLM_MODEL_MINI` is set. Each id is a key
 *  in the cost model (`model-pricing.ts`) so usage logs get a real `cost_micros`. */
const DEFAULT_MODEL: Record<"openai" | "anthropic" | "gemini", string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-1.5-flash",
};

/**
 * Resolve a real (network) chat LLM from the environment, or `null` to fall back to the offline
 * stub. Selection: explicit `LLM_PROVIDER` (openai|anthropic|gemini) if set and its key is present,
 * else the first provider whose API key is configured. `tier:"mini"` reads `LLM_MODEL_MINI` for the
 * fair-use degrade tier; `tier:"standard"` reads `LLM_MODEL`. Returns `null` (→ Echo) when no key is
 * available, so dev with no keys keeps working unchanged.
 */
function selectChatLlm(env: NodeJS.ProcessEnv, tier: "standard" | "mini"): LlmProvider | null {
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();

  const provider =
    explicit && explicit.length > 0
      ? explicit
      : openaiKey
        ? "openai"
        : anthropicKey
          ? "anthropic"
          : geminiKey
            ? "gemini"
            : null;

  const modelOverride = (tier === "mini" ? env.LLM_MODEL_MINI : env.LLM_MODEL)?.trim() || undefined;

  switch (provider) {
    case "openai":
      if (!openaiKey) return null;
      return new OpenAiLlmProvider({ apiKey: openaiKey, model: modelOverride ?? DEFAULT_MODEL.openai });
    case "anthropic":
      if (!anthropicKey) return null;
      return new AnthropicLlmProvider({ apiKey: anthropicKey, model: modelOverride ?? DEFAULT_MODEL.anthropic });
    case "gemini":
      if (!geminiKey) return null;
      return new GeminiLlmProvider({ apiKey: geminiKey, model: modelOverride ?? DEFAULT_MODEL.gemini });
    default:
      return null;
  }
}

/**
 * Default chat LLM (M3.1). Uses a real provider (OpenAI/Anthropic/Gemini) when an API key is
 * configured — see {@link selectChatLlm} — and otherwise the offline, deterministic
 * {@link EchoLlmProvider} so the chat pipeline still runs end-to-end with no network/key. This is
 * the single swap point shared by {@link ChatModule} (DI) and any other completion consumer.
 */
export function createDefaultLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  return selectChatLlm(env, "standard") ?? new EchoLlmProvider();
}

/**
 * Cheaper fair-use LLM tier (M6.3): served once a user passes their plan's soft threshold instead of
 * blocking. Uses the real provider with `LLM_MODEL_MINI` when a key is set, else the echo engine
 * under a distinct model name (`echo-dev-mini`) so the degrade stays observable in usage logs.
 */
export function createDegradedLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  return selectChatLlm(env, "mini") ?? new EchoLlmProvider("echo-dev-mini");
}
