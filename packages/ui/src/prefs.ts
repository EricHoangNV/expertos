/**
 * Chat display density (M12.7.3) — the "DENSITY & OPTIONS" preference the Tweaks
 * panel exposes alongside the layout direction ({@link LayoutDirection}). Density
 * is presentational only: it tightens or loosens the vertical rhythm of the
 * message thread via a `chat-density-{density}` modifier on the `.chat-layout`
 * root (ds.css), the same shape as the direction modifier.
 *
 *  - `compact` — tighter spacing, more turns on screen.
 *  - `regular` — the default rhythm.
 *  - `comfy`   — looser spacing, more breathing room.
 */
export type Density = "compact" | "regular" | "comfy";

/** Selectable densities, in display order (the `.seg` control order, M12.7.3). */
export const DENSITIES: readonly Density[] = ["compact", "regular", "comfy"];

/** The mockup's default density (regular vertical rhythm). */
export const DEFAULT_DENSITY: Density = "regular";

/** One-line label + description per density (the `.seg` option copy, M12.7.3). */
export const DENSITY_INFO: Record<Density, { label: string; description: string }> = {
  compact: { label: "Compact", description: "Tighter spacing — more turns on screen." },
  regular: { label: "Regular", description: "The default vertical rhythm." },
  comfy: { label: "Comfy", description: "Looser spacing — more breathing room." },
};

/** Type guard for persisting/restoring density (e.g. from localStorage, M12.7.3). */
export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && (DENSITIES as readonly string[]).includes(value);
}
