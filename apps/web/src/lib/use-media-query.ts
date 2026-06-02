"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and return whether it currently matches. SSR-safe:
 * starts `false` on the server (and the first client render) and updates after mount,
 * then tracks viewport changes via the `MediaQueryList` change event.
 *
 * Used by the chat page (M12.5.4) to know whether the persistent sources rail is on
 * screen (`>= 1280px`) — below that the rail collapses (ds.css, M12.1.1) and sources
 * route to the slide-over drawer instead.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
