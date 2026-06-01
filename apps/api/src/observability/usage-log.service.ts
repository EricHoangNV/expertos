import { Injectable } from "@nestjs/common";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "./logger.service";
import { costMicrosFor } from "./model-pricing";

/**
 * One billable/observable unit of work — an LLM call, an embedding batch, a retrieval.
 * Token + cost fields are optional because not every feature has them (e.g. a cache hit
 * records the feature with zero model cost).
 */
interface UsageLogEntry {
  /** Stable feature identifier, e.g. `"chat.answer"`, `"ingest.embed"`. */
  featureKey: string;
  /** Provider model id, when an LLM/embedding model was involved. */
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Cost in millionths of a USD cent (integer-safe; matches `usage_logs.cost_micros`). */
  costMicros?: number;
  /** Conversation this usage belongs to, when applicable. */
  conversationId?: string;
  /** True when the chat answer touched a high-stakes topic (NT.4) — logged for monitoring. */
  highStakes?: boolean;
}

/**
 * Persists per-user cost/usage rows to `usage_logs` — the raw data feeding fair-use
 * enforcement (M6), unit-economics analysis (Open Decision #4), and usage/cost analytics
 * (M10). Writes go through {@link RlsService} so the row is automatically scoped to the
 * acting user's tenant/user and satisfies the table's `tenant_user_isolation` RLS policy.
 *
 * Logging usage must never break the request that produced it: `record` swallows and
 * reports write failures rather than propagating them to the caller.
 */
@Injectable()
export class UsageLogService {
  constructor(
    private readonly rls: RlsService,
    private readonly logger: StructuredLogger,
  ) {}

  async record(user: AuthUser, entry: UsageLogEntry): Promise<void> {
    try {
      // Model the cost from the token counts when the caller didn't supply one (Open Decision #4,
      // M6.5): every call that names a `model` gets a real `cost_micros` so margin analysis (M10)
      // and billing reconciliation have a signal. A cache hit (model named, 0 tokens) lands at cost 0
      // — the degrade/cache margin win is then visible in the ledger, not hidden as null.
      const costMicros =
        entry.costMicros ??
        (entry.model !== undefined
          ? costMicrosFor(entry.model, entry.promptTokens ?? 0, entry.completionTokens ?? 0)
          : null);

      await this.rls.run(user, (tx) =>
        tx.usageLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            featureKey: entry.featureKey,
            model: entry.model ?? null,
            promptTokens: entry.promptTokens ?? null,
            completionTokens: entry.completionTokens ?? null,
            costMicros,
            conversationId: entry.conversationId ?? null,
            highStakes: entry.highStakes ?? false,
          },
        }),
      );
    } catch (error) {
      // Best-effort: a usage-logging failure must never break the user's request.
      this.logger.error("Failed to record usage log", {
        featureKey: entry.featureKey,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
