/**
 * Tests for `useMediaQuery` (M15.1.6). The hook is SSR-safe (starts `false`, syncs after
 * mount) and tracks `MediaQueryList` change events. The shared jsdom matchMedia stub in
 * `jest.setup` always returns `matches: true`; here we install a controllable fake so we can
 * drive the initial match value and fire change events, then restore it afterwards.
 */
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./use-media-query";

type Listener = (e: MediaQueryListEvent) => void;

/** A controllable matchMedia: `setMatch(query, bool)` flips state and notifies listeners. */
function installControllableMatchMedia(initial: Record<string, boolean>) {
  const listeners = new Map<string, Set<Listener>>();
  const state = { ...initial };

  window.matchMedia = ((query: string) => ({
    get matches() {
      return state[query] ?? false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: Listener) => {
      const set = listeners.get(query) ?? new Set<Listener>();
      set.add(cb);
      listeners.set(query, set);
    },
    removeEventListener: (_type: string, cb: Listener) => {
      listeners.get(query)?.delete(cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  return {
    setMatch(query: string, matches: boolean) {
      state[query] = matches;
      for (const cb of listeners.get(query) ?? []) {
        cb({ matches } as MediaQueryListEvent);
      }
    },
    listenerCount(query: string): number {
      return listeners.get(query)?.size ?? 0;
    },
  };
}

describe("useMediaQuery", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("reflects the initial match state after mount", () => {
    installControllableMatchMedia({ "(min-width: 1280px)": true });
    const { result } = renderHook(() => useMediaQuery("(min-width: 1280px)"));
    expect(result.current).toBe(true);
  });

  it("returns false when the query does not match", () => {
    installControllableMatchMedia({ "(min-width: 1280px)": false });
    const { result } = renderHook(() => useMediaQuery("(min-width: 1280px)"));
    expect(result.current).toBe(false);
  });

  it("updates when the viewport crosses the breakpoint", () => {
    const mm = installControllableMatchMedia({ "(min-width: 900px)": false });
    const { result } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    expect(result.current).toBe(false);

    act(() => mm.setMatch("(min-width: 900px)", true));
    expect(result.current).toBe(true);

    act(() => mm.setMatch("(min-width: 900px)", false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes the change listener on unmount", () => {
    const mm = installControllableMatchMedia({ "(min-width: 900px)": true });
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    expect(mm.listenerCount("(min-width: 900px)")).toBe(1);
    unmount();
    expect(mm.listenerCount("(min-width: 900px)")).toBe(0);
  });

  it("re-subscribes to the new query when it changes", () => {
    const mm = installControllableMatchMedia({
      "(min-width: 900px)": true,
      "(min-width: 1280px)": false,
    });
    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: "(min-width: 900px)" },
    });
    expect(result.current).toBe(true);
    expect(mm.listenerCount("(min-width: 900px)")).toBe(1);

    rerender({ q: "(min-width: 1280px)" });
    expect(result.current).toBe(false);
    // The old query's listener was torn down; the new one is subscribed.
    expect(mm.listenerCount("(min-width: 900px)")).toBe(0);
    expect(mm.listenerCount("(min-width: 1280px)")).toBe(1);
  });

  it("stays false when matchMedia is unavailable (SSR-safe guard)", () => {
    // @ts-expect-error — simulate an environment without matchMedia.
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1280px)"));
    expect(result.current).toBe(false);
  });
});
