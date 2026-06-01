import { RateLimitService } from "./rate-limit.service";
import type { RateLimitOptions } from "./rate-limit.config";

/** A controllable clock so window math is deterministic. */
function makeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function makeService(
  overrides: Partial<RateLimitOptions> & { now: () => number },
): RateLimitService {
  const options: RateLimitOptions = {
    windowMs: 60_000,
    max: 3,
    maxTrackedKeys: 50_000,
    ...overrides,
  };
  return new RateLimitService(options);
}

describe("RateLimitService", () => {
  it("allows requests under the ceiling and decrements remaining each hit", () => {
    const clock = makeClock();
    const svc = makeService({ now: clock.now, max: 3 });

    const first = svc.hit("ip-a");
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(3);
    expect(first.remaining).toBe(2);
    expect(first.retryAfterMs).toBe(0);
    expect(first.resetAt).toBe(clock.now() + 60_000);

    expect(svc.hit("ip-a").remaining).toBe(1);
    const third = svc.hit("ip-a");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks once the ceiling is passed, with a stable resetAt and a positive retryAfter", () => {
    const clock = makeClock();
    const svc = makeService({ now: clock.now, max: 2 });

    const r1 = svc.hit("ip-b");
    svc.hit("ip-b");
    const resetAt = r1.resetAt;

    clock.advance(10_000); // still inside the window
    const blocked = svc.hit("ip-b");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // Window start is preserved across hits, so the reset instant does not move.
    expect(blocked.resetAt).toBe(resetAt);
    expect(blocked.retryAfterMs).toBe(resetAt - clock.now());
    expect(blocked.retryAfterMs).toBe(50_000);
  });

  it("opens a fresh window once the previous one fully elapses", () => {
    const clock = makeClock();
    const svc = makeService({ now: clock.now, max: 1 });

    expect(svc.hit("ip-c").allowed).toBe(true);
    expect(svc.hit("ip-c").allowed).toBe(false); // second within the window is blocked

    clock.advance(60_000); // window elapsed exactly
    const reopened = svc.hit("ip-c");
    expect(reopened.allowed).toBe(true);
    expect(reopened.remaining).toBe(0);
    expect(reopened.resetAt).toBe(clock.now() + 60_000);
  });

  it("keeps independent buckets per key", () => {
    const clock = makeClock();
    const svc = makeService({ now: clock.now, max: 1 });

    expect(svc.hit("ip-x").allowed).toBe(true);
    expect(svc.hit("ip-x").allowed).toBe(false);
    // A different key is unaffected by ip-x exhausting its window.
    expect(svc.hit("ip-y").allowed).toBe(true);
  });

  it("bounds tracked keys: an evicted cold key starts a fresh window", () => {
    const clock = makeClock();
    const svc = makeService({ now: clock.now, max: 1, maxTrackedKeys: 2 });

    svc.hit("ip-1"); // exhausts ip-1's single-request window
    expect(svc.hit("ip-1").allowed).toBe(false);

    // Spray two more keys → capacity 2 evicts the least-recently-used (ip-1).
    svc.hit("ip-2");
    svc.hit("ip-3");

    // ip-1's bucket was evicted, so it is treated as a brand-new window (allowed again).
    expect(svc.hit("ip-1").allowed).toBe(true);
  });

  it("defaults the clock to Date.now when none is injected", () => {
    const svc = new RateLimitService({
      windowMs: 60_000,
      max: 1,
      maxTrackedKeys: 10,
    });
    const before = Date.now();
    const result = svc.hit("ip-default");
    expect(result.allowed).toBe(true);
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 60_000);
  });
});
