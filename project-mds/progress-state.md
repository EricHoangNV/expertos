# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: COMPLETE (M12.1–M12.9).
- M13 (UI i18n — EN+VI): M13.1 DONE (i18n core + web provider/hooks). M13.2 DONE — web string extraction across `/chat`/`/history`/`/account` (chat 55 / history 42 / account 16 keys). M13.4 DONE — system content: high-stakes disclaimer now locale-aware (`HIGH_STAKES_DISCLAIMERS` EN+VI in shared), consultation CTA copy localized (`ChatConsultationCard` `maybeLaterLabel`/`askAnotherLabel` props + 3 chat keys); insufficient + concierge tooltip already done in M13.2. M13.5 DONE — locale-aware formatters (`localeTag`/`formatNumber`/`formatCurrency`/`formatDateTime` in `@expertos/ui`, guarded) wired into web account `formatPrice` + history `when()`; RTL N/A (EN/VI both LTR). **M13.3 (admin i18n) = last open M13-i18n task.**
- M13 (Admin & Expert Portal UI Overhaul) — admin rebuild to mockups. DONE: M13.1 (nav regroup + count badges + identity footer + role-aware topbar), M13.2 (dashboard: KPI grid/`StackedBar`/funnel/pipeline/SLA + rollups `/admin/analytics/questions` + `/knowledge-pipeline`), M13.3 (knowledge kanban + Conv→Knowledge table; fixed `KnowledgeService.transition()` status lockstep — LEARNINGS #16), M13.4 (entitlement matrix: staged-edit + `PlanPrice` join), M13.6 (concierge two-pane; `Badge` gained `dot`; Claim/Dismiss omitted = no endpoint). DEFERRED: M13.5 (voice profile page — mockup has NO schema backing; needs PM/schema decision).
- M14 (Access Control Whitelist) — invite-only admin portal gate: COMPLETE. `AllowedEmail` model + RLS; `POST /me/admin-session` whitelist gate; `/admin/access-control` CRUD (self-lockout + audit); AdminFrame Access Denied; bootstrap admin seeded.
- Tests: 1274 pass / 0 fail / 0 skip (shared 190, ui 234, db 9, ai 161, api 680). (admin has no jest suite; web has no jest suite.)
- Gates (run per-workspace — `turbo` SIGILLs here): shared/ui/api build/eslint/jest + admin/web `tsc` + `next lint` + root `lint:css` + root `knip` all clean. (`rm -rf apps/*/.next` before knip — it flags stale `.next` dirs.) (`next build` + `tsx` seed blocked in-sandbox by arch mismatch — environmental; migrations validated via `prisma migrate deploy` + raw SQL.)

- Next tasks (priority order):
  1. **M13.3 (i18n)** — Translate admin: add the i18n layer to `apps/admin` (reuse `@expertos/ui` core + new formatters; needs its own provider/dictionaries; ~26 pages, large).
  2. **M13.7 (admin)** — polish & ds.css conformance audit (`.voice-bar` gated on M13.5 admin).
  3. **M13.5 (admin)** — Voice profile page: blocked on a schema decision; flag to PM.
  4. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- i18n core (M13.1/M13.5): `@expertos/ui` `Locale`/`Messages`/`translate`/`createTranslator` (pure) + locale-aware formatters `localeTag`/`formatNumber`/`formatCurrency`/`formatDateTime` (M13.5, NaN/invalid-guarded); web `LocaleProvider`/`useLocale`/`useT` in `apps/web/src/lib/i18n/` + dictionaries.ts (EN/VI) + `PATCH /me/locale`. M13.3 = add admin's own provider/dictionaries (reuse the same ui core + formatters).
- `useMediaQuery`: ≥900px sidebar / ≥1280px rail. Avatar: `avatarInitials`/`avatarTone` + `.avatar.tone-*`.
- ds.css: `Skeleton`, `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `StackedBar`, `prefs.ts`; `.dark-card`, `.kanban`/`.kanban-col`, `.review-pane`/`.queue-list`/`.verdict-card`; `Badge` takes optional `dot`.
- `SourceCard` optional `matchPercent`/`version`/`onSelect`; `ChatTopbar` `leading` slot; `Textarea` optional `inputRef`. Admin status→tone: `apps/admin/src/lib/status-tone.ts`.
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
