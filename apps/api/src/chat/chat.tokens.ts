/**
 * DI token for the chat completion provider (M3.1). Mirrors `RETRIEVAL_EMBEDDING_PROVIDER` /
 * `VOICE_EMBEDDING_PROVIDER`: the concrete provider is bound in {@link ChatModule} via
 * `createDefaultLlmProvider`, so production swaps the real driver in one place.
 */
export const CHAT_LLM_PROVIDER = "CHAT_LLM_PROVIDER";
