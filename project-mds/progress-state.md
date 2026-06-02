# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for the per-task detail; this file tracks the in-flight UI overhaul).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild to the approved mockup: **COMPLETE** (M12.1–M12.9 all done).
  - M12.9.2 ds.css conformance + M12.9.3 dark-sidebar render: DONE (audit, no code changes) — zero hardcoded hex/px in app code (Google-brand login SVG scoped-disabled), upload=info-blue vs knowledge=crimson never mixed, `.side`-based dark sidebar verified incl. mobile drawer; stylelint + ui/web eslint + ui jest + knip all green.
- M13 (Admin & Expert Portal UI Overhaul) — admin portal rebuild to the approved mockups:
  - M13.1.1 sidebar nav restructure: DONE — `AdminFrame` `NAV` regrouped into OPERATE / MONETIZE / EXPERT PORTAL (+ ANALYTICS / SYSTEM); per-item `group`+`role`, role-filtered `GROUP_ORDER` render; Dashboard `/` exact-match active.
  - M13.1.2 count badges: DONE — `useNavCounts` fetches knowledge-review / open-concierge / flagged-query counts; `.navitem .tag` chip, capped 99→"99+".
  - **M13.1.3 / M13.1.4: DONE** — `SidebarFooter` bottom-pins avatar+name+"Admin/Expert · ExpertOS" role label + ghost sign-out (moved off topbar, `.side-foot` dark-ghost restyle); topbar now carries the role-aware `.crumb` breadcrumb ("Admin/Expert Portal › PageName") + "Admin/Expert view" `.badge-red`/`.badge-amber` + a notification bell `.btn-icon`. ("All screens" link omitted — mockup-deck nav artifact, no screen-index page.)
  - **M13.2.1 / M13.2.2: DONE** — `apps/admin/app/page.tsx` rebuilt the bare landing page into the dashboard top section: hour-keyed greeting + auth display-name, `.eyebrow`/`.lede` header, `.seg` 7d/30d/QTD control (QTD → quarter-to-date day count) driving the analytics `days` query, over a new ds.css `.kpi-grid` of 4 `Stat` cards — MRR (+ MoM delta from the revenue period series), Active subscribers, Consult conversions (funnel-attributed + booked revenue), Activation rate. The mockup's "Citation resolve rate" KPI is **not** a measured metric (resolvability is enforced by render-after-resolve, OD#7) → the activation make-or-break signal stands in. M13.2.3–.7 (Questions Answered split, Funnel/Low-confidence/Pipeline/SLA cards) deferred — and note: M13.2.3's grounded/low-conf/insufficient breakdown has **no** platform-wide API aggregate, so it needs either a new backend rollup or an honest substitution.
- Tests: 1221 pass / 0 fail / 0 skip (shared 179, ui 213, db 9, ai 161, api 659).
- Gates (run per-workspace — `turbo` SIGILLs in this sandbox): ui build/eslint/jest + root `lint:css` (stylelint) + admin `tsc --noEmit` + `next lint` + root `knip` all clean. (admin has no jest suite; `next build` blocked in-sandbox by the missing linux/arm64 SWC native binary — environmental, not code.)

- Next tasks (priority order):
  1. **M13.2.3–.7** — remaining dashboard cards: Questions Answered (M13.2.3 — needs a backend grounded/low-conf/insufficient rollup or an honest substitution; no current API), Consultation Funnel (M13.2.4 — `/admin/analytics/funnel`, fully backed), Low-Confidence Queries (M13.2.5 — `/admin/failed-queries`, fully backed), Knowledge Pipeline (M13.2.6 — `/knowledge` by status, fully backed), Concierge SLA dark card (M13.2.7 — `/admin/analytics/concierge` SLA, fully backed; also exercises the M13.7.2 `.dark-card`).
  2. **M13.3–M13.7** — knowledge kanban, plans matrix, voice profile, concierge review queue, shared patterns.
  3. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- `useMediaQuery` (`apps/web/src/lib/use-media-query.ts`): ≥900px sidebar / ≥1280px rail breakpoints.
- Avatar helpers: `avatarInitials`/`avatarTone` + `.avatar.tone-*` (deterministic expert color).
- `/chat` helpers: `sourceCards()`, `sidebarBody`/`sidebarFooter` (shared grid + overlay).
- ds.css primitives: `Skeleton` (shimmer; size via paired class), `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `.tweaks-section`/`.tweaks-toggles`, `prefs.ts` `Density`/`isDensity`.
- `SourceCard` accepts optional `matchPercent`/`version`/`onSelect` (not yet wired — DTO lacks score/version); `ChatTopbar` has a `leading` slot; shared `Textarea` takes an optional `inputRef` (plain prop, not React `ref`).
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/`.
