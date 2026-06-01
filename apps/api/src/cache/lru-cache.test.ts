import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("stores and returns a live value", () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000, now: () => 0 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires an entry once its TTL has elapsed", () => {
    let clock = 0;
    const cache = new LruCache<string>({ maxEntries: 4, ttlMs: 100, now: () => clock });
    cache.set("k", "v");

    clock = 99;
    expect(cache.get("k")).toBe("v");
    clock = 100;
    expect(cache.get("k")).toBeUndefined();
    // The expired entry is dropped on read.
    expect(cache.size).toBe(0);
  });

  it("evicts the least-recently-used entry past capacity", () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    // Touch "a" so "b" becomes the LRU.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("re-setting a key refreshes its value and recency", () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 11); // a is now most-recent
    cache.set("c", 3); // evicts b (the LRU), not a

    expect(cache.get("a")).toBe(11);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("deletes a key", () => {
    const cache = new LruCache<number>({ maxEntries: 2, ttlMs: 1000, now: () => 0 });
    cache.set("a", 1);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("never holds fewer than one entry even with a tiny capacity", () => {
    const cache = new LruCache<number>({ maxEntries: 0, ttlMs: 1000, now: () => 0 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("deletes only the entries matching a prefix and reports the count removed", () => {
    const cache = new LruCache<number>({ maxEntries: 10, ttlMs: 1000, now: () => 0 });
    cache.set("answer\nt1\nq1", 1);
    cache.set("answer\nt1\nq2", 2);
    cache.set("answer\nt2\nq1", 3); // a different tenant — must survive

    const removed = cache.deletePrefix("answer\nt1\n");

    expect(removed).toBe(2);
    expect(cache.get("answer\nt1\nq1")).toBeUndefined();
    expect(cache.get("answer\nt1\nq2")).toBeUndefined();
    expect(cache.get("answer\nt2\nq1")).toBe(3);
  });
});
