import { z } from "zod";

/**
 * Runtime answer-tuning settings (M17, PRD §"M17 — Runtime answer-tuning settings"). A global
 * singleton edited by admins (`GET`/`PATCH /admin/app-settings`) that tunes the grounded-QA answer
 * path in real time: LLM temperature, the default chat model, and the retrieval relevance floor.
 *
 * Mirrors the `ReviewConfig`/`ConciergeConfig` shape exactly — one global row, no per-tenant scope,
 * no RLS (admin-guarded at the controller). The `SettingsService` reads it through a 30s TTL cache
 * so a Save takes effect on the next message with no restart.
 *
 * The embedding provider is deliberately NOT here — switching embedders invalidates existing vectors
 * (cosine becomes meaningless), so it is env + restart only (`EMBEDDING_PROVIDER`), surfaced in the
 * Settings UI as read-only.
 */

/**
 * Allowlist of selectable default chat models for the standard answer tier. Constrained so every
 * choice is guaranteed a `model-pricing.ts` entry (usage-log cost tracking matches the effective
 * model). `gpt-4o-mini` = STANDARD, `gpt-4o` = PREMIUM.
 */
export const CHAT_MODELS = ["gpt-4o-mini", "gpt-4o"] as const;
export type ChatModelValue = (typeof CHAT_MODELS)[number];
export const chatModelSchema = z.enum(CHAT_MODELS);

/** Bounds — accidental-absurd-value protection, not product limits. */
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2; // OpenAI's documented sampling ceiling
const MIN_SCORE_FLOOR = 0;
const MAX_SCORE_FLOOR = 1; // RRF fused scores are small (~0.016/rank); 1 is a generous guard

/**
 * The editable runtime settings (`PATCH /admin/app-settings`). No identity field — global singleton.
 *  - `llmTemperature` — sampling temperature for the grounded answer call (0 = deterministic, lower
 *    is better for cited QA; default 0.2).
 *  - `defaultChatModel` — the standard-tier chat model (allowlist; the degraded/fair-use mini tier is
 *    untouched by this setting).
 *  - `retrievalScoreFloor` — minimum fused RRF score a chunk must clear to reach the model. `0` = off.
 *    Note the unit: this is the RRF fused score (small magnitudes), NOT a 0–1 cosine similarity.
 */
export const appSettingsUpdateSchema = z.object({
  llmTemperature: z.number().min(MIN_TEMPERATURE).max(MAX_TEMPERATURE),
  defaultChatModel: chatModelSchema,
  retrievalScoreFloor: z.number().min(MIN_SCORE_FLOOR).max(MAX_SCORE_FLOOR),
});

export type AppSettingsUpdateInput = z.infer<typeof appSettingsUpdateSchema>;

/**
 * The runtime settings as shown in the admin Settings page (`GET /admin/app-settings`).
 * `embeddingProvider` is read-only context (env-driven, restart-required) so the UI can show the
 * active embedder with a "restart required" note — it is not an editable field.
 */
export interface AppSettingsDto {
  llmTemperature: number;
  defaultChatModel: ChatModelValue;
  retrievalScoreFloor: number;
  /** Active embedding provider (env-driven, restart-required) — read-only context for the UI. */
  embeddingProvider: string;
  /** ISO-8601 last-updated timestamp, or null if the settings row has never been saved. */
  updatedAt: string | null;
}
