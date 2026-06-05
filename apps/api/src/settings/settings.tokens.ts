/** DI token for the active embedding provider name shown read-only in the admin Settings page. */
export const SETTINGS_EMBEDDING_PROVIDER_NAME = "SETTINGS_EMBEDDING_PROVIDER_NAME";

/**
 * Resolve the active embedding provider's display name from the environment. This mirrors the gate
 * {@link createDefaultEmbeddingProvider} uses (M17.6): the real OpenAI embedder is opt-in via
 * `EMBEDDING_PROVIDER=openai`, otherwise the dev hashing embedder is active. Surfaced read-only in the
 * Settings UI because switching embedders invalidates existing vectors — it is env + restart, never a
 * live toggle.
 */
export function resolveEmbeddingProviderName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.EMBEDDING_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "hashing";
}
