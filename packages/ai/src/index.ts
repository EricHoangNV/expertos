export { cosineSimilarity } from "./similarity";
export { chunkText, estimateTokens } from "./ingestion/chunk";
export type { TextChunk, ChunkOptions } from "./ingestion/chunk";
export {
  extractiveSummary,
  ExtractiveSummarizer,
  LlmSummarizer,
} from "./ingestion/summarize";
export type { Summarizer, ExtractiveOptions } from "./ingestion/summarize";
export { HashingEmbeddingProvider } from "./embedding/hashing-embedding-provider";
export type {
  ChatMessage,
  LlmCompletion,
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
export type {
  PromptLanguage,
  PromptFact,
  VoiceProfileInput,
  VoiceExampleInput,
  AnswerPromptInput,
  AnswerPrompt,
} from "./prompt/types";
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
