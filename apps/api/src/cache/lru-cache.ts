/**
 * A tiny in-process LRU cache with per-entry TTL (M6.4). This is the "in-process LRU cache" the
 * architecture calls for at launch — Postgres-backed counters + an in-process hot cache, with
 * Memorystore Redis introduced only when volume justifies it (PRD §"No full infra Day 1"). When
 * that day comes, the swap point is here: replace the {@link Map} with a Redis-backed store behind
 * the same `get`/`set` shape; nothing else in the cache layer needs to change.
 *
 * It is deterministic and clock-injectable so eviction/expiry are unit-testable without timers.
 * Recency is tracked by {@link Map} insertion order: a `get`/`set` re-inserts the key to the most-
 * recent position, so the oldest key is always the first iterated and is evicted first past
 * capacity. Expired entries are dropped lazily on read (and proactively on the evicted path), which
 * is sufficient for a hot cache — there is no background sweep.
 */
interface LruCacheOptions {
  /** Maximum live entries; the least-recently-used entry is evicted past this. */
  maxEntries: number;
  /** Per-entry time-to-live in milliseconds; a stale entry is dropped on read. */
  ttlMs: number;
  /** Clock seam (defaults to `Date.now`) so expiry is deterministic in tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  /** Wall-clock ms after which the entry is stale. */
  expiresAt: number;
}

/**
 * A point-in-time snapshot of a cache's effectiveness (M11.3). Hit rate is the lever the caching
 * tuning turns — `maxEntries`/`ttlMs` are only worth changing once you can see the hit rate they
 * produce, so this is what {@link ResponseCacheService.stats} surfaces to the admin cache endpoint.
 * Counters are cumulative since process start and **per-instance** (the cache is in-process), so a
 * multi-instance deployment reports per-instance rates — fine for a single-instance load smoke.
 */
interface LruCacheStats {
  /** Live entries currently held (including not-yet-read expired ones). */
  size: number;
  /** Configured capacity — `size` pressing on this with a high `evictions` count means it's too small. */
  maxEntries: number;
  /** Lookups that returned a live value. */
  hits: number;
  /** Lookups that found nothing live (a never-seen key or an expired one — see `expirations`). */
  misses: number;
  /** Entries dropped by the capacity ceiling (a high count argues for a larger `maxEntries`). */
  evictions: number;
  /** Misses caused by a TTL expiry specifically (a high count argues for a longer `ttlMs`). */
  expirations: number;
  /** `hits / (hits + misses)`, or `0` before any lookup. The headline tuning number. */
  hitRate: number;
}

export class LruCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expirations = 0;

  constructor(options: LruCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  /** Returns the live value for `key`, or `undefined` when missing or expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      this.expirations += 1;
      this.misses += 1;
      return undefined;
    }
    // Refresh recency: re-insert at the most-recent position.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /** Stores `value` under `key`, evicting the least-recently-used entry past capacity. */
  set(key: string, value: V): void {
    // Delete first so a re-set moves the key to the most-recent position.
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
      this.evictions += 1;
    }
  }

  /** Drops `key` if present. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Drops every entry whose key starts with `prefix`, returning the count removed. Keys are
   * `\n`-delimited segment composites (see `ResponseCacheService`), so a tenant-scoped prefix
   * like `answer\n<tenantId>\n` matches exactly that tenant's entries — the hook publish-time
   * invalidation uses so one tenant's publish never nukes another tenant's hot cache.
   */
  deletePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of entries currently held (including not-yet-read expired ones). */
  get size(): number {
    return this.store.size;
  }

  /** Cumulative effectiveness snapshot since process start (M11.3 — see {@link LruCacheStats}). */
  stats(): LruCacheStats {
    const lookups = this.hits + this.misses;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      hitRate: lookups === 0 ? 0 : this.hits / lookups,
    };
  }
}
