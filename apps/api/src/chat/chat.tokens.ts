/**
 * DI token for the chat completion provider (M3.1). Mirrors `RETRIEVAL_EMBEDDING_PROVIDER` /
 * `VOICE_EMBEDDING_PROVIDER`: the concrete provider is bound in {@link ChatModule} via
 * `createDefaultLlmProvider`, so production swaps the real driver in one place.
 */
export const CHAT_LLM_PROVIDER = "CHAT_LLM_PROVIDER";

/**
 * DI token for the cheaper fair-use chat tier (M6.3). Bound in {@link ChatModule} via
 * `createDegradedLlmProvider`; {@link ChatService} serves answers with it once the entitlement guard
 * reports the actor has passed their fair-use soft threshold (degrade, don't block) rather than the
 * standard {@link CHAT_LLM_PROVIDER}.
 */
export const CHAT_DEGRADED_LLM_PROVIDER = "CHAT_DEGRADED_LLM_PROVIDER";
