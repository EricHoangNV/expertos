# Progress

## Current State

- Phase 0 + Phase 1 (M1–M11) backend/admin/expert work: COMPLETE (see PRD Task Manifest for per-task detail).
- M12 (Frontend UI Overhaul) — consumer web `/chat` rebuild: COMPLETE (M12.1–M12.9).
- M13 (UI i18n — EN+VI): **COMPLETE** (M13.1–M13.5). Web + admin each have own `LocaleProvider`/`useLocale`/`useT`; admin dictionaries SPLIT per-page-namespace + `useStatusLabel()`; system content (high-stakes disclaimer, consult CTA) locale-aware; locale-aware formatters in `@expertos/ui`. Both persist via `PATCH /me/locale`.
- M13 (Admin & Expert Portal UI Overhaul): DONE M13.1/.2/.3/.4/.6/.7(.1/.2/.3/.5). **M13.5 voice profile page = schema-honest lean** (`GET /voice-profiles/:id` + `apps/admin/app/voice-profiles/[id]/page.tsx`: avatar/status/sign-off/warning/guidelines/examples). M13.5.3/.4/.5 + .6 fidelity + M13.7.4 `.voice-bar` DEFERRED — no schema backing for structured voice dimensions; needs PM/schema decision.
- M14 (Access Control Whitelist) — invite-only admin portal gate: COMPLETE. `AllowedEmail` model + RLS; `POST /me/admin-session` whitelist gate; `/admin/access-control` CRUD (self-lockout + audit); AdminFrame Access Denied; bootstrap admin seeded.
- M15 (Test coverage) — IN PROGRESS. M15.1.1 DONE (web jest harness). M15.1.2 DONE: `apps/web/app/chat/page.test.tsx` (10 tests) — empty/signed-out states, send→SSE-stream→append flow, citation→sources-rail resolve, voice-picker selection on next turn, layout-direction switch+persist, stream error path, insufficient/high-stakes/degraded notices. SSE support added to the harness fetch mock (`mockApi(...,{sse:[...]})` → ReadableStream body). Rest of M15.1.3–.6 / M15.2 (admin) / M15.3 (E2E) open.
- Tests: 1295 pass / 0 fail / 0 skip (shared 190, ui 234, db 9, ai 161, api 686, web 15). (admin has no jest suite yet.)
- Gates (run per-workspace — `turbo` SIGILLs here): shared/ui/api build/eslint/jest + admin/web `tsc`/`next lint` + web `jest` + root `lint:css`/`knip` all clean. (`rm -rf apps/*/.next` before knip.) (`next build` + `tsx` seed blocked in-sandbox by arch mismatch — migrations validated via `prisma migrate deploy` + raw SQL.)

- Next tasks (priority order):
  1. **M15.1.3** — web history page tests (conversation list + search, detail replay + saved answers, rename, delete) on the harness.
  2. **M15.1.4–.6** — web account/i18n/hooks tests, then **M15.2** (admin jest suite — needs its own harness mirroring web) + **M15.3** (E2E expansion).
  3. **M13.5.3/.4/.5 + M13.7.4** — structured voice widgets: BLOCKED on a PM/schema decision (no backing); flag to PM.
  4. **M11.4 / NT human gates** — NT.3/NT.4 PM/legal sign-offs; M11.1 fixme legs await external surfaces.

### Reusable building blocks for remaining UI work
- i18n core (M13.1/M13.5): `@expertos/ui` `translate`/`createTranslator` + formatters `localeTag`/`formatNumber`/`formatCurrency`/`formatDateTime` (NaN-guarded). Web `LocaleProvider`/`useT` in `apps/web/src/lib/i18n/` (single dictionaries.ts); admin same but dictionaries SPLIT per-page under `dictionaries/<route>.ts` + `useStatusLabel()`.
- `useMediaQuery`: ≥900px sidebar / ≥1280px rail. Avatar: `avatarInitials`/`avatarTone`. Admin status→tone: `apps/admin/src/lib/status-tone.ts` (tones only; labels via `useStatusLabel()`). ds.css primitives + `.dark-card`/`.kanban`/`.review-pane`/`.verdict-card` exist (see PRD M12/M13 entries).
- NOTE: rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
- **Web test harness (M15.1.1):** `apps/web/test/render.tsx` `renderWithProviders(ui, { user?, locale? })` (real Auth+Locale providers); `setMockUser`/`makeMockUser` (firebase auth); `mockApi("GET","/path", {body}|handler)` + `apiCalls()` (manual `fetch`, keyed `METHOD pathname`, default 404); `getMockRouter()`/`setMockPathname` (next/navigation spies); all re-exported from `test/render`. Manual mocks live in `__mocks__/firebase/*` + `__mocks__/next/navigation.ts` (auto-applied — keep jest `roots` at default). **SSE: `mockApi("POST","/chat",{sse:[event,...]})` serves `data:`-framed events as a ReadableStream body so `streamChat` parses them for real** (jest.setup polyfills TextEncoder/TextDecoder/ReadableStream from node built-ins for jsdom). Run: `pnpm --filter @expertos/web test`. ts-jest preset (NOT next/jest — next-swc arch-broken in-sandbox). Only `@testing-library/react` stays in knip `ignoreDependencies` (dom + user-event are now resolved as used).
