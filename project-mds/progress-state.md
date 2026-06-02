# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: **COMPLETE** (M12.1–M12.9).
- M13 (Admin & Expert Portal UI Overhaul) — admin portal rebuild to the approved mockups:
  - M13.1: DONE — sidebar nav regrouped (OPERATE/MONETIZE/EXPERT PORTAL + ANALYTICS/SYSTEM), count badges, bottom-pinned identity footer + sign-out, role-aware topbar breadcrumb + view badge + bell.
  - M13.2 (Dashboard): COMPLETE — greeting + 7d/30d/QTD `.seg` control over KPI grid (MRR/subscribers/conversions/activation), Questions Answered card (`StackedBar`), Consultation Funnel card, Low-Confidence Queries card, Knowledge Pipeline card, Concierge SLA card (`.dark-card`). New backend rollups: `/admin/analytics/questions` + `/admin/analytics/knowledge-pipeline`.
  - M13.3 (Knowledge approval kanban): COMPLETE (M13.3.1–M13.3.5) — `apps/admin/app/knowledge/page.tsx` rebuilt the flat table into: page header + numbered status-pipeline step indicator (Expert Review active/crimson) + 4-column `.kanban` board (DRAFT ink → AI PROCESSING info → EXPERT REVIEW amber → PUBLISHED green) + Conversation → Knowledge `.table`. Column counts from `/admin/analytics/knowledge-pipeline` (accurate; list is take:50-bounded), cards from `/knowledge/documents?status=`×4, Expert Review "Approve & publish" → `/knowledge/versions/:id/approve`, conv→knowledge table from `/knowledge-drafts`. New ds.css `.kanban*`/`.kanban-step*`/`.convknow*`. Honest-data deviations: file-type/expert chips, published citation count, "Upload" header action omitted (no DTO field / no admin ingestion-upload endpoint — M1.1 seed/CLI); AI-processing progress approximated from chunkCount.
  - M13.4 (Plans & Entitlements matrix): COMPLETE (M13.4.1–M13.4.4) — `apps/admin/app/entitlements/page.tsx` rebuilt into a staged-edit `.matrix-table`: eyebrow/h1/lede header + Discard/Publish-N-changes actions (batch PATCH over the per-cell `/admin/entitlements` route), plan columns with real pricing (new `EntitlementPlanPriceDto`/`prices[]` on the matrix DTO + `PlanPrice` join), top-tier column crimson-emphasized, boolean cells = `.switch` / metered = limit input + window select + soft-limit + "UNLIMITED", dirty "Unsaved" badge + inline errors, FAIR USE / QUOTA CELLS footer cards. New ds.css `.matrix-*` block. Honest deviations: ghost action is "Discard changes" (no reset-to-seed endpoint); no `enum` feature type exists in the data model.
- Tests: 1229 pass / 0 fail / 0 skip (shared 179, ui 217, db 9, ai 161, api 663). (admin has no jest suite.)
- Gates (run per-workspace — `turbo` SIGILLs in this sandbox): shared/ui/api build/eslint/jest + admin `tsc --noEmit` + `next lint` + web `tsc` + root `lint:css` (stylelint) + root `knip` all clean. (`next build` blocked in-sandbox by missing linux/arm64 SWC binary — environmental.)

- Next tasks (priority order):
  1. **M13.5** — Voice profile page (Expert Portal): `.voice-bar` dimension bars, do/don't rules, voice comparison, examples table; wire to `/voice-profiles`.
  2. **M13.6–M13.7** — concierge review queue two-pane (`.verdict-card`/`.queue-list`/`.review-detail`), shared patterns + ds.css conformance audit.
  3. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- `useMediaQuery` (`apps/web/src/lib/use-media-query.ts`): ≥900px sidebar / ≥1280px rail breakpoints.
- Avatar helpers: `avatarInitials`/`avatarTone` + `.avatar.tone-*` (deterministic expert color).
- ds.css primitives: `Skeleton`, `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `StackedBar` (`.progress-bar-stacked`), `prefs.ts` `Density`/`isDensity`.
- `.dark-card` (M13.7.2) — `--ink-900`/white/`--r-lg` card; compose with `Card pad className="dark-card …"`. For M13.6 user-question bubbles + any inverted panel.
- `.kanban`/`.kanban-col` (M13.3 / M13.7.3) — horizontal flex board of independently-scrolling column cards + `.kanban-card`(`.is-active` amber highlight) + `.kanban-step*` numbered pipeline. Reuse for any status-pipeline board.
- `SourceCard` accepts optional `matchPercent`/`version`/`onSelect` (unwired — DTO lacks); `ChatTopbar` has a `leading` slot; shared `Textarea` takes optional `inputRef`.
- Admin status→tone helpers: `apps/admin/src/lib/status-tone.ts` (`publishStatusTone`/`draftStatusTone`/`statusLabel`/etc.).
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/`.
