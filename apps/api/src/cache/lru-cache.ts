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

export class LruCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: LruCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  /** Returns the live value for `key`, or `undefined` when missing or expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency: re-insert at the most-recent position.
    this.store.delete(key);
    this.store.set(key, entry);
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
    }
  }

  /** Drops `key` if present. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Number of entries currently held (including not-yet-read expired ones). */
  get size(): number {
    return this.store.size;
  }
}
