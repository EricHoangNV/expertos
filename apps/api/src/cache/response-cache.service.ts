import { Injectable } from "@nestjs/common";
import { normalizeText, type RetrievedChunk } from "@expertos/ai";
import type { RetrievalQueryInput } from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { LruCache } from "./lru-cache";
import { PgSemanticCacheStore } from "./semantic-cache.store";
import type { CachedAnswer } from "./cache.types";
import {
  ANSWER_CACHE,
  RETRIEVAL_CACHE,
  SEMANTIC_CACHE_MAX_AGE_MS,
} from "./cache.config";

/** The shared inputs that determine an answer, hashed into the answer/semantic cache key. */
interface AnswerKeyParams {
  /** The user's question (normalized into the key). */
  text: string;
  /** Retrieval depth — different `topK` retrieves different facts, so different answers. */
  topK: number;
  /** Chosen expert voice (the voice layer changes the prose); none = neutral voice. */
  expertId?: string;
  /** Requested answer language (affects the prompt + voice selection). */
  language?: string;
  /** Model tier (standard vs degraded) — keeps the entitlement tiers' answers separate (M6.3). */
  model: string;
}

/**
 * The single caching choke point for M6.4 — neither {@link RetrievalService} nor {@link ChatService}
 * hand-rolls a cache key or TTL. It owns three layers from the PRD architecture
 * (semantic → retrieval → answer):
 *
 * - **Retrieval cache** (in-process LRU): query + scope → knowledge chunks. Skips the query embed +
 *   vector/keyword search. Tenant id is in the key, so a shared process can never leak across
 *   tenants; it benefits *every* turn (even multi-turn ones), since retrieval is history-independent.
 * - **Answer cache** (in-process LRU): query + scope + voice + language + model tier → the full
 *   resolved answer. The hot tier — skips the LLM call entirely on a hit.
 * - **Semantic cache** (persistent, {@link PgSemanticCacheStore}): the durable cross-instance tier of
 *   the answer cache, consulted when the in-process answer cache misses and warmed on a hit.
 *
 * **Entitlement-correctness (M6.3):** the model tier is part of the answer key, so a degraded-model
 * answer is never served to a standard-tier user and vice versa. Caching never touches the usage
 * counter — the entitlement guard already reserved one unit before the request reached the handler,
 * so a cache hit neither double-counts nor refunds quota.
 */
@Injectable()
export class ResponseCacheService {
  private readonly retrievalCache = new LruCache<RetrievedChunk[]>(RETRIEVAL_CACHE);
  private readonly answerCache = new LruCache<CachedAnswer>(ANSWER_CACHE);

  constructor(
    private readonly rls: RlsService,
    private readonly logger: StructuredLogger,
  ) {}

  // Retrieval layer ────────────────────────────────────────────────────────

  /** Builds the retrieval cache key from the tenant + the (normalized) query and its scope. */
  retrievalKey(tenantId: string, query: RetrievalQueryInput): string {
    const { status, language, scope } = query.filters;
    return join([
      "retrieval",
      tenantId,
      String(query.topK),
      status,
      language ?? "",
      // Scope is a set — sort so order can't fork the key.
      (scope ? [...scope].sort() : []).join(","),
      normalizeKey(query.text),
    ]);
  }

  getRetrieval(key: string): RetrievedChunk[] | undefined {
    return this.retrievalCache.get(key);
  }

  setRetrieval(key: string, chunks: RetrievedChunk[]): void {
    this.retrievalCache.set(key, chunks);
  }

  // Answer / semantic layer ──────────────────────────────────────────────────

  /** Builds the answer cache key (shared inputs that fully determine the generated answer). */
  answerKey(tenantId: string, params: AnswerKeyParams): string {
    return join([
      "answer",
      tenantId,
      params.model,
      params.expertId ?? "",
      params.language ?? "",
      String(params.topK),
      normalizeKey(params.text),
    ]);
  }

  /**
   * Looks up a cached answer: the in-process answer cache first, then the persistent semantic cache
   * (warming the in-process tier on a persistent hit). Returns `undefined` on a miss.
   */
  async lookupAnswer(
    user: AuthUser,
    key: string,
    model: string,
  ): Promise<CachedAnswer | undefined> {
    const hot = this.answerCache.get(key);
    if (hot) {
      this.logger.info("answer cache hit", { tier: "memory" });
      return hot;
    }

    const cutoff = new Date(Date.now() - SEMANTIC_CACHE_MAX_AGE_MS);
    const persisted = await this.rls.run(user, (tx) =>
      new PgSemanticCacheStore(tx).lookup({
        tenantId: user.tenantId,
        normalizedQuestion: key,
        model,
        notOlderThan: cutoff,
      }),
    );
    if (persisted) {
      this.answerCache.set(key, persisted);
      this.logger.info("answer cache hit", { tier: "semantic" });
      return persisted;
    }
    return undefined;
  }

  /** Write-through: populate both the in-process answer cache and the persistent semantic cache. */
  async storeAnswer(user: AuthUser, key: string, answer: CachedAnswer): Promise<void> {
    this.answerCache.set(key, answer);
    await this.rls.run(user, (tx) =>
      new PgSemanticCacheStore(tx).store({
        tenantId: user.tenantId,
        normalizedQuestion: key,
        model: answer.model,
        answer,
      }),
    );
  }
}

/**
 * Joins key segments with a newline — a separator the normalized inputs can never contain
 * (`normalizeKey` collapses all whitespace, incl. newlines, to a single space; ids/model/language
 * carry none), so segment boundaries are unambiguous and two different inputs can't collide.
 */
function join(segments: string[]): string {
  return segments.join("\n");
}

/** NFC-normalize + lowercase + collapse whitespace so trivially-different queries share a key. */
function normalizeKey(text: string): string {
  return normalizeText(text).toLowerCase().trim().replace(/\s+/g, " ");
}
