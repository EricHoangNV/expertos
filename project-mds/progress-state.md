# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: COMPLETE (M12.1–M12.9).
- M13 (UI i18n — EN+VI): **COMPLETE.** M13.1 (i18n core + web provider/hooks), M13.2 (web string extraction `/chat`/`/history`/`/account`), M13.4 (system content: high-stakes disclaimer + consultation CTA locale-aware), M13.5 (locale-aware formatters). M13.3 DONE — admin i18n: own `LocaleProvider`/`useLocale`/`useT` in `apps/admin/src/lib/i18n/` (mirrors web, localStorage `expertos:admin-locale`); EN/VI `.seg` toggle in `AdminFrame` topbar; per-page-namespace dictionaries (`dictionaries/<route>.ts`, 24 ns, ~900 keys, lockstep-verified); all 25 pages + chrome wired; status badges via locale-aware `useStatusLabel()` hook over a shared `common.status.*` map (43 tokens) with underscore→space fallback.
- M13 (Admin & Expert Portal UI Overhaul) — admin rebuild to mockups. DONE: M13.1, M13.2, M13.3, M13.4, M13.6, M13.7 (.7.1/.7.2/.7.3/.7.5). **M13.5 (voice profile page) — built schema-honest lean version:** new `GET /voice-profiles/:id` (`VoiceProfileService.get`, ownership/RLS) + `apps/admin/app/voice-profiles/[id]/page.tsx` (avatar+name+status+awaiting-signoff badge+sign-off actions [.1], amber warning banner [.2], guidelines card, real examples list [.6 partial]). M13.5.3/.4/.5 + fidelity/per-row-approve of .6 + M13.7.4 `.voice-bar` remain DEFERRED — **no schema backing** for the structured voice dimensions/do-don't/comparison/fidelity (only free-text `guidelines` + `prompt`/`content` exist); fabricating them = an unreviewed voice model baked into the prompt builder. Needs PM/schema decision.
- M14 (Access Control Whitelist) — invite-only admin portal gate: COMPLETE. `AllowedEmail` model + RLS; `POST /me/admin-session` whitelist gate; `/admin/access-control` CRUD (self-lockout + audit); AdminFrame Access Denied; bootstrap admin seeded.
- Tests: 1280 pass / 0 fail / 0 skip (shared 190, ui 234, db 9, ai 161, api 686). (admin has no jest suite; web has no jest suite.)
- Gates (run per-workspace — `turbo` SIGILLs here): shared/ui/api build/eslint/jest + admin/web `tsc` + `next lint` + root `lint:css` + root `knip` all clean. (`rm -rf apps/*/.next` before knip — it flags stale `.next` dirs.) (`next build` + `tsx` seed blocked in-sandbox by arch mismatch — environmental; migrations validated via `prisma migrate deploy` + raw SQL.)

- Next tasks (priority order):
  1. **M13.5.3/.4/.5 + M13.7.4** — structured voice widgets: BLOCKED on a PM/schema decision (no backing); flag to PM.
  2. **M11.4 / NT human gates** — NT.3/NT.4 PM/legal sign-offs; M11.1 fixme legs await external surfaces.
  3. (No other open implementation tasks — all remaining manifest `[ ]` are human/PM gates or blocked-on-decision.)

### Reusable building blocks for remaining UI work
- i18n core (M13.1/M13.5): `@expertos/ui` `Locale`/`Messages`/`translate`/`createTranslator` (pure) + locale-aware formatters `localeTag`/`formatNumber`/`formatCurrency`/`formatDateTime` (M13.5, NaN/invalid-guarded). Web: `LocaleProvider`/`useLocale`/`useT` in `apps/web/src/lib/i18n/` + single dictionaries.ts. Admin: same in `apps/admin/src/lib/i18n/` but dictionaries SPLIT per-page-namespace under `dictionaries/<route>.ts` (assembled by `dictionaries.ts`) + `useStatusLabel()` for enum badges. Both persist via `PATCH /me/locale`.
- `useMediaQuery`: ≥900px sidebar / ≥1280px rail. Avatar: `avatarInitials`/`avatarTone` + `.avatar.tone-*`.
- ds.css: `Skeleton`, `ChatTypingIndicator`, `ChatEmptyState`, `ChatSidebarDrawer`/`ChatMenuButton`, `StackedBar`, `prefs.ts`; `.dark-card`, `.kanban`/`.kanban-col`, `.review-pane`/`.queue-list`/`.verdict-card`; `Badge` takes optional `dot`.
- `SourceCard` optional `matchPercent`/`version`/`onSelect`; `ChatTopbar` `leading` slot; `Textarea` optional `inputRef`. Admin status→tone: `apps/admin/src/lib/status-tone.ts` (tones only; status display labels are now via i18n `useStatusLabel()`).
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
