# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: COMPLETE (M12.1–M12.9).
- M13 (Admin & Expert Portal UI Overhaul) — admin portal rebuild to the approved mockups:
  - M13.1: DONE — sidebar nav regrouped (OPERATE/MONETIZE/EXPERT PORTAL + ANALYTICS/SYSTEM), count badges, identity footer + sign-out, role-aware topbar.
  - M13.2 (Dashboard): DONE — greeting + 7d/30d/QTD `.seg`, KPI grid, Questions Answered (`StackedBar`), Funnel, Low-Confidence, Knowledge Pipeline, Concierge SLA (`.dark-card`). New rollups `/admin/analytics/questions` + `/knowledge-pipeline`.
  - M13.3 (Knowledge kanban): DONE — status-pipeline steps + 4-column `.kanban` board + Conversation→Knowledge table.
  - M13.4 (Plans & Entitlements matrix): DONE — staged-edit `.matrix-table`, real plan pricing (`prices[]` + `PlanPrice` join), per-cell batch PATCH.
  - M13.6 (Concierge review queue two-pane): DONE — `.review-pane` (`.queue-list` + `.review-detail`), Open/Mine/Done `.seg`, `.dark-card` question, selectable `.verdict-card`, refined-answer textarea, Push/Escalate → respond/escalate. `Badge` gained an optional `dot` prop. Deviations: Claim/Dismiss omitted (no endpoint), Mine=`claimedAt`-set, no user email/voice in DTO.
  - M13.5 (Voice profile page): DEFERRED — mockup (dimension bars/do-don't/terminology/fidelity) has NO schema backing; needs a PM/schema decision before building. See log.
- M14 (Access Control Whitelist) — invite-only admin portal gate: COMPLETE (M14.1–M14.4). `AllowedEmail` model + RLS migration; `POST /me/admin-session` whitelist gate (role-sync, 403); `/admin/access-control` CRUD (self-lockout + audit + 409); auth-context `denied` + AdminFrame Access Denied screen; Access Control page; bootstrap admin seeded.
- Tests: 1254 pass / 0 fail / 0 skip (shared 187, ui 218, db 9, ai 161, api 679). (admin has no jest suite.)
- Gates (run per-workspace — `turbo` SIGILLs here): shared/ui/api build/eslint/jest + admin `tsc --noEmit` + `next lint` + web `tsc` + root `lint:css` + root `knip` all clean. (`next build` blocked in-sandbox by missing linux/arm64 SWC — environmental; `tsx` seed also blocked by an esbuild darwin/linux arch mismatch — migration validated via `prisma migrate deploy` + raw SQL instead.)

- Next tasks (priority order):
  1. **M13.7** — Admin polish & shared patterns: role-aware sidebar + ds.css conformance audit (most primitives already exist; `.voice-bar` is gated on the M13.5 decision).
  2. **M13.5** — Voice profile page: blocked on a data decision (mockup has no schema backing); flag to PM.
  3. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- `useMediaQuery` (`apps/web/src/lib/use-media-query.ts`): ≥900px sidebar / ≥1280px rail.
- Avatar helpers: `avatarInitials`/`avatarTone` + `.avatar.tone-*`.
- ds.css primitives: `Skeleton`, `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `StackedBar`, `prefs.ts` `Density`/`isDensity`.
- `.dark-card` (M13.7.2) — `--ink-900`/white card; compose with `Card pad className="dark-card …"`.
- `.kanban`/`.kanban-col` (M13.3 / M13.7.3) — status-pipeline board (`.kanban-card`/`.kanban-step*`).
- `.review-pane`/`.queue-list`/`.review-detail`/`.verdict-card` (M13.6) — two-pane list+detail + selectable cards; `Badge` takes optional `dot`.
- `SourceCard` accepts optional `matchPercent`/`version`/`onSelect`; `ChatTopbar` has a `leading` slot; shared `Textarea` takes optional `inputRef`.
- Admin status→tone helpers: `apps/admin/src/lib/status-tone.ts`.
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
