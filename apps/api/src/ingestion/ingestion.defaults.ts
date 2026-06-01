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
  EchoLlmProvider,
  ExtractiveSummarizer,
  HashingEmbeddingProvider,
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

export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  return new HashingEmbeddingProvider();
}

export function createDefaultSummarizer(): Summarizer {
  return new ExtractiveSummarizer();
}

/**
 * Default (offline, deterministic) chat LLM (M3.1). Mirrors {@link createDefaultEmbeddingProvider}:
 * production swaps the real OpenAI/Anthropic driver in here once and both the chat endpoint and
 * any other completion consumer follow. The {@link EchoLlmProvider} grounds its answer on the
 * built prompt's sources and needs no network/API key, so the chat pipeline runs end-to-end here.
 */
export function createDefaultLlmProvider(): LlmProvider {
  return new EchoLlmProvider();
}
