import { Injectable } from "@nestjs/common";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "./logger.service";

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
      await this.rls.run(user, (tx) =>
        tx.usageLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            featureKey: entry.featureKey,
            model: entry.model ?? null,
            promptTokens: entry.promptTokens ?? null,
            completionTokens: entry.completionTokens ?? null,
            costMicros: entry.costMicros ?? null,
            conversationId: entry.conversationId ?? null,
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
