import { Inject, Injectable } from "@nestjs/common";
import { LruCache } from "../cache/lru-cache";
import { RATE_LIMIT_OPTIONS, type RateLimitOptions } from "./rate-limit.config";

/** The verdict of a single {@link RateLimitService.hit}. */
export interface RateLimitResult {
  /** Whether this request is within the per-window ceiling. */
  allowed: boolean;
  /** The configured ceiling (echoed as `X-RateLimit-Limit`). */
  limit: number;
  /** Requests still permitted in the current window (`X-RateLimit-Remaining`), floored at 0. */
  remaining: number;
  /** Epoch-ms at which the current window resets (`X-RateLimit-Reset`). */
  resetAt: number;
  /** Ms until the window resets; `0` when allowed (drives the `Retry-After` header on a block). */
  retryAfterMs: number;
}

/** A per-key fixed window: the count consumed and the instant the window opened. */
interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * The single rate-limiting choke point (M11.2). A deterministic fixed-window counter keyed by client
 * IP: the first request in a window opens it, each subsequent request increments, and once the count
 * passes {@link RateLimitOptions.max} the window is blocked until it elapses. Window math is clock-
 * injectable (via {@link RateLimitOptions.now}) so expiry/reset are unit-testable without timers.
 *
 * Storage is the in-process {@link LruCache} (PRD §"No full infra Day 1") — bounded to
 * `maxTrackedKeys` so an attacker spraying distinct source IPs evicts cold buckets instead of growing
 * memory without limit. The cache TTL (2× the window) garbage-collects idle keys; the window-reset is
 * still decided here by wall-clock so a re-seen key always evaluates against a correct window. When
 * Memorystore Redis lands this is the swap point — replace the {@link LruCache} with a Redis store
 * behind the same `get`/`set` and the limiter becomes cross-instance.
 */
@Injectable()
export class RateLimitService {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly buckets: LruCache<Bucket>;

  constructor(@Inject(RATE_LIMIT_OPTIONS) options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.now = options.now ?? Date.now;
    this.buckets = new LruCache<Bucket>({
      maxEntries: options.maxTrackedKeys,
      // Outlive the window so a key isn't evicted mid-window by TTL; the window-reset below is the
      // real boundary, the TTL only reclaims idle keys.
      ttlMs: options.windowMs * 2,
      now: this.now,
    });
  }

  /** Records one request for `key` and returns whether it is within the per-window ceiling. */
  hit(key: string): RateLimitResult {
    const now = this.now();
    const existing = this.buckets.get(key);

    // Open a fresh window when the key is new or its previous window has fully elapsed; otherwise
    // increment within the still-open window (preserving its original start so `resetAt` is stable).
    const bucket: Bucket =
      !existing || now - existing.windowStart >= this.windowMs
        ? { count: 1, windowStart: now }
        : { count: existing.count + 1, windowStart: existing.windowStart };
    this.buckets.set(key, bucket);

    const resetAt = bucket.windowStart + this.windowMs;
    const allowed = bucket.count <= this.max;
    return {
      allowed,
      limit: this.max,
      remaining: Math.max(0, this.max - bucket.count),
      resetAt,
      retryAfterMs: allowed ? 0 : Math.max(0, resetAt - now),
    };
  }
}
