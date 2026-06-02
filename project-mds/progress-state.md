# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: COMPLETE (M12.1–M12.9).
- M13 (UI i18n — EN+VI): M13.1 DONE — i18n core in `@expertos/ui` (`Locale`/`translate`/`createTranslator`, pure, 100% tested) + web `LocaleProvider`/`useLocale`/`useT` (localStorage + `PATCH /me/locale` persistence, `<html lang>` sync); chat `language` state lifted to global locale (drives UI + answer lang). Starter `chat` namespace wired; full string extraction = M13.2–M13.5.
- M13 (Admin & Expert Portal UI Overhaul) — admin portal rebuild to the approved mockups:
  - M13.1: DONE — sidebar nav regrouped (OPERATE/MONETIZE/EXPERT PORTAL + ANALYTICS/SYSTEM), count badges, identity footer + sign-out, role-aware topbar.
  - M13.2 (Dashboard): DONE — greeting + 7d/30d/QTD `.seg`, KPI grid, Questions Answered (`StackedBar`), Funnel, Low-Confidence, Knowledge Pipeline, Concierge SLA. New rollups `/admin/analytics/questions` + `/knowledge-pipeline`.
  - M13.3 (Knowledge kanban): DONE — status-pipeline steps + 4-col `.kanban` + Conversation→Knowledge table.
  - M13.4 (Plans & Entitlements matrix): DONE — staged-edit `.matrix-table`, real plan pricing (`PlanPrice` join), per-cell batch PATCH.
  - M13.6 (Concierge review queue two-pane): DONE — `.review-pane`, Open/Mine/Done `.seg`, `.dark-card` question, `.verdict-card`, Push/Escalate. `Badge` gained `dot`. Deviations: Claim/Dismiss omitted (no endpoint).
  - M13.5 (Voice profile page): DEFERRED — mockup (dimension bars/do-don't/terminology/fidelity) has NO schema backing; needs a PM/schema decision before building. See log.
- M14 (Access Control Whitelist) — invite-only admin portal gate: COMPLETE. `AllowedEmail` model + RLS; `POST /me/admin-session` whitelist gate; `/admin/access-control` CRUD (self-lockout + audit); AdminFrame Access Denied; bootstrap admin seeded.
- Tests: 1263 pass / 0 fail / 0 skip (shared 187, ui 226, db 9, ai 161, api 680). (admin has no jest suite.)
- Gates (run per-workspace — `turbo` SIGILLs here): shared/ui/api build/eslint/jest + admin `tsc --noEmit` + `next lint` + web `tsc` + root `lint:css` + root `knip` all clean. (`next build` blocked in-sandbox by missing linux/arm64 SWC — environmental; `tsx` seed also blocked by an esbuild darwin/linux arch mismatch — migration validated via `prisma migrate deploy` + raw SQL instead.)

- Next tasks (priority order):
  1. **M13.2 (i18n)** — Translate web app: extract `/chat`/`/history`/`/account` strings via `useT` (many live in `@expertos/ui` components → pass translated text as props).
  2. **M13.3 (i18n)** — Translate admin: add the i18n layer to `apps/admin` (reuse `@expertos/ui` core; needs its own provider/dictionaries).
  3. **M13.4/M13.5 (i18n)** — system content (disclaimers/CTAs) + locale-aware date/number/currency formatting.
  4. **M13.7 (admin)** — polish & ds.css conformance audit (`.voice-bar` gated on M13.5).
  5. **M13.5 (admin)** — Voice profile page: blocked on a schema decision; flag to PM.
  6. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.

### Reusable building blocks for remaining UI work
- i18n core (M13.1): `@expertos/ui` `Locale`/`Messages`/`translate`/`createTranslator` (pure); web `LocaleProvider`/`useLocale`/`useT` in `apps/web/src/lib/i18n/` + dictionaries.ts (EN/VI) + `PATCH /me/locale`. M13.3 = add admin's own provider/dictionaries.
- `useMediaQuery`: ≥900px sidebar / ≥1280px rail. Avatar: `avatarInitials`/`avatarTone` + `.avatar.tone-*`.
- ds.css: `Skeleton`, `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `StackedBar`, `prefs.ts`; `.dark-card`, `.kanban`/`.kanban-col`, `.review-pane`/`.queue-list`/`.verdict-card`; `Badge` takes optional `dot`.
- `SourceCard` optional `matchPercent`/`version`/`onSelect`; `ChatTopbar` `leading` slot; `Textarea` optional `inputRef`. Admin status→tone: `apps/admin/src/lib/status-tone.ts`.
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
