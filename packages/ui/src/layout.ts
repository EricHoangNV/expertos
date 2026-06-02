/**
 * Chat layout direction (M12.1.3) — the "switcher state" the Tweaks panel
 * (M12.7.2) toggles and persists. The direction is presentational only: it
 * decides which panes live in the persistent `.chat-layout` grid vs. reopen as
 * a slide-over drawer/overlay (M12.5.4 sources drawer, M12.9.1 sidebar overlay).
 *
 *  - `studio`  — the default three-pane: sidebar + chat + sources rail.
 *  - `classic` — two-pane (sidebar + chat); sources move to a drawer overlay.
 *  - `focus`   — distraction-free, expert-forward: chat only; sidebar and
 *                sources both reopen as overlays/drawers.
 *
 * `ChatLayout` consumes {@link layoutPanes} to drop a pane for the active
 * direction even when content is supplied; the dropped pane's content is handed
 * to the drawer/overlay in the later tasks. Responsive breakpoints (ds.css)
 * already drop the rail < 1280px and the sidebar < 900px on top of this.
 */
export type LayoutDirection = "classic" | "studio" | "focus";

/** Selectable directions, in display order (the `.seg` control order, M12.7.2). */
export const LAYOUT_DIRECTIONS: readonly LayoutDirection[] = ["classic", "studio", "focus"];

/** The mockup's default direction (persistent three-pane studio). */
export const DEFAULT_LAYOUT_DIRECTION: LayoutDirection = "studio";

/** One-line label + description per direction (the `.seg` option copy, M12.7.2). */
export const LAYOUT_DIRECTION_INFO: Record<
  LayoutDirection,
  { label: string; description: string }
> = {
  classic: { label: "Classic", description: "History + chat, sources in a drawer." },
  studio: { label: "Studio", description: "Sidebar + chat + a persistent sources rail." },
  focus: { label: "Focus", description: "Distraction-free; sidebar and sources in drawers." },
};

/** Which panes belong in the persistent grid for a direction. */
export interface LayoutPanes {
  /** The left conversation sidebar is part of the grid (vs. an overlay). */
  sidebar: boolean;
  /** The right sources rail is part of the grid (vs. a drawer). */
  rail: boolean;
}

/**
 * Pure mapping from a layout direction to its persistent-grid panes. A `false`
 * pane is still available to the consumer to render in a drawer/overlay; it just
 * doesn't occupy a grid column.
 */
export function layoutPanes(direction: LayoutDirection): LayoutPanes {
  switch (direction) {
    case "studio":
      return { sidebar: true, rail: true };
    case "classic":
      return { sidebar: true, rail: false };
    case "focus":
      return { sidebar: false, rail: false };
  }
}

/** Type guard for persisting/restoring the direction (e.g. from localStorage, M12.7.2). */
export function isLayoutDirection(value: unknown): value is LayoutDirection {
  return typeof value === "string" && (LAYOUT_DIRECTIONS as readonly string[]).includes(value);
}
