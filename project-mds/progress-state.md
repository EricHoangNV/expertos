# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for the per-task detail; this file tracks the in-flight UI overhaul).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild to the approved mockup:
  - M12.1 chat layout shell (three-pane grid + `ChatLayout` + classic/studio/focus directions): DONE
  - M12.2 sidebar (logo + "+ New conversation" + search + RECENT list + usage meter): DONE
  - M12.3 topbar (editable title + voice picker + user identity + EN/VI): DONE
  - M12.4 messages area (user bubble, assistant header, AnswerProse citations, action bar, consultation card, state notices): DONE
  - M12.5 sources rail (container + header + source cards + drawer fallback): DONE
  - M12.6 input bar (sticky composer + upload popover + helper text + keyboard/auto-resize): DONE
  - M12.7 Tweaks panel (floating panel + layout-direction + density/toggles + topbar show/hide): DONE
  - M12.8 login page + post-login redirect: DONE
  - M12.9.1 mobile sidebar overlay (`ChatSidebarDrawer` + `ChatMenuButton` + topbar `leading` slot): DONE
  - **M12.9.4 loading/empty states: DONE** — `Skeleton` (aria-hidden shimmer), `ChatTypingIndicator` (3-dot streaming `role=status`), `ChatEmptyState` ("Start a new conversation"); `ChatConversationList` loading → 4 skeleton rows (`aria-busy`); ds.css "Loading & empty states (M12.9.4)" + `prefers-reduced-motion` block. Wired into `/chat` (`AssistantAnswer` typing indicator, empty-thread empty state).
- Tests: 1221 pass / 0 fail / 0 skip (shared 179, ui 213, db 9, ai 161, api 659).
- Gates (run per-workspace — `turbo` SIGILLs in this sandbox): ui jest 213 pass / 100% coverage; `tsc --noEmit` clean (ui + web + admin, after rebuilding `packages/ui` dist); `next lint` clean; `stylelint` clean; `knip` clean.

- Next tasks (priority order):
  1. **M12.9.2** — ds.css conformance audit (no hardcoded colors/px outside ds.css scale; upload=info-blue `.cite.upload`/`badge-info` vs knowledge=crimson `.cite`/`badge-red` maintained across all M12 components). Read `requirements/ui-reference-spec.md` + `Design System.md`.
  2. **M12.9.3** — dark-sidebar render check (logo, nav items, search, usage on `--ink-900`).
  3. **M13 (Admin Portal UI Overhaul)** — sidebar/dashboard/kanban/matrix/voice/concierge rebuilds.
  4. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- `useMediaQuery` (`apps/web/src/lib/use-media-query.ts`): ≥900px sidebar / ≥1280px rail breakpoints.
- Avatar helpers: `avatarInitials`/`avatarTone` + `.avatar.tone-*` (deterministic expert color).
- `/chat` helpers: `sourceCards()`, `sidebarBody`/`sidebarFooter` (shared grid + overlay).
- ds.css primitives: `Skeleton` (shimmer; size via paired class), `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `.tweaks-section`/`.tweaks-toggles`, `prefs.ts` `Density`/`isDensity`.
- `SourceCard` accepts optional `matchPercent`/`version`/`onSelect` (not yet wired — DTO lacks score/version); `ChatTopbar` has a `leading` slot; shared `Textarea` takes an optional `inputRef` (plain prop, not React `ref`).
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/`.
