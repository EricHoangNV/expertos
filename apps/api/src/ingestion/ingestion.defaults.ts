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
  ExtractiveSummarizer,
  HashingEmbeddingProvider,
  type EmbeddingProvider,
  type Summarizer,
} from "@expertos/ai";
import { ParserRegistry } from "./parser-registry";
import { TextParser } from "./parsers/text-parser";
import { CsvParser } from "./parsers/csv-parser";

export function createDefaultParserRegistry(): ParserRegistry {
  return new ParserRegistry([new TextParser(), new CsvParser()]);
}

export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  return new HashingEmbeddingProvider();
}

export function createDefaultSummarizer(): Summarizer {
  return new ExtractiveSummarizer();
}
