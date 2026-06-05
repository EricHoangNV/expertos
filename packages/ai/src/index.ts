export { cosineSimilarity } from "./similarity";
export { chunkText, estimateTokens } from "./ingestion/chunk";
export type { TextChunk, ChunkOptions } from "./ingestion/chunk";
export { normalizeText } from "./text";
export {
  extractiveSummary,
  ExtractiveSummarizer,
  LlmSummarizer,
} from "./ingestion/summarize";
export type { Summarizer, ExtractiveOptions } from "./ingestion/summarize";
export { HashingEmbeddingProvider } from "./embedding/hashing-embedding-provider";
export { EchoLlmProvider } from "./llm/echo-llm-provider";
export { OpenAiLlmProvider } from "./llm/openai-llm-provider";
export type { OpenAiLlmConfig } from "./llm/openai-llm-provider";
export { AnthropicLlmProvider } from "./llm/anthropic-llm-provider";
export type { AnthropicLlmConfig } from "./llm/anthropic-llm-provider";
export { GeminiLlmProvider } from "./llm/gemini-llm-provider";
export type { GeminiLlmConfig } from "./llm/gemini-llm-provider";
export {
  StreamingLlmProvider,
  LlmRequestError,
  readSseEvents,
  sseData,
  estimateUsage,
} from "./llm/http";
export type { FetchLike, FetchRequestInit, FetchResponseLike } from "./llm/http";
export type {
  ChatMessage,
  LlmCallOptions,
  LlmCompletion,
  LlmStreamChunk,
  LlmProvider,
  EmbeddingProvider,
  RetrievedChunk,
  VectorStore,
} from "./providers";
export { fuseHybrid } from "./retrieval/fusion";
export type { FusionOptions } from "./retrieval/fusion";
export type {
  RetrievalScope,
  RetrievalLanguage,
  RetrievalStatus,
  RetrievalFilters,
  RetrievalRequest,
  RankedChunk,
} from "./retrieval/types";
export { buildAnswerPrompt } from "./prompt/answer-prompt";
export { buildAttribution } from "./prompt/attribution";
export type { AttributionInfo } from "./prompt/attribution";
export { buildCitations } from "./prompt/citations";
export type {
  CitationSource,
  ResolvedCitation,
  BuildCitationsInput,
  BuiltCitations,
} from "./prompt/citations";
export type {
  PromptLanguage,
  PromptFact,
  VoiceProfileInput,
  VoiceExampleInput,
  AnswerPromptInput,
  AnswerPrompt,
} from "./prompt/types";
export { detectHighStakes } from "./high-stakes/detect";
export { HIGH_STAKES_CATEGORIES } from "./high-stakes/types";
export type { HighStakesCategory, HighStakesResult } from "./high-stakes/types";
export { evaluateRecommendation } from "./recommendation/evaluate";
export { RECOMMENDATION_TRIGGERS } from "./recommendation/types";
export type {
  RecommendationTrigger,
  RecommendationRule,
  RecommendationSignals,
  RecommendationOutcome,
} from "./recommendation/types";
export { evaluateRetrieval } from "./eval/harness";
export { RETRIEVAL_GOLDEN_SET } from "./eval/golden-set";
export type {
  EvalDocument,
  EvalCase,
  EvalGoldenSet,
  EvalOptions,
  EvalCaseResult,
  EvalReport,
} from "./eval/types";
export { evaluateVoice } from "./eval/voice-harness";
export { VOICE_GOLDEN_SET } from "./eval/voice-golden-set";
export { VOICE_FIDELITY_BAR, FACT_ADHERENCE_BAR } from "./eval/voice-metrics";
export type {
  VoiceEvalCase,
  VoiceGoldenSet,
  VoiceJudge,
  VoiceJudgeRequest,
  VoiceJudgeVerdict,
  VoiceEvalOptions,
  StructuralVoiceResult,
  LiveVoiceResult,
  VoiceCaseResult,
  VoiceEvalReport,
} from "./eval/voice-types";
