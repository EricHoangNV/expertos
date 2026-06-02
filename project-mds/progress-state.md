# Progress

## Current State

Phase 1 (MVP) is functionally launch-ready. All open `[ ]` manifest items are externally blocked (human/PM sign-off, schema decision, or host-only E2E run) — no in-sandbox coding task advances the manifest.

- Phase 0 + Phase 1 backend/admin/expert (M1–M11): COMPLETE.
- M12 (consumer web `/chat` UI overhaul): COMPLETE (M12.1–M12.9).
- M13 (UI i18n EN+VI): COMPLETE. Web + admin each own `LocaleProvider`/`useT`; admin dicts split per-page-namespace + `useStatusLabel()`; system content locale-aware; formatters in `@expertos/ui`; persist via `PATCH /me/locale`.
- M13 (admin/expert portal UI overhaul): DONE except the voice-dimension widgets — M13.5.3/.4/.5, M13.5.6 fidelity, M13.7.4 `.voice-bar` DEFERRED (no schema backing; needs PM/schema decision — experts legally sign off on the voice model). M13.5 ships schema-honest lean (`GET /voice-profiles/:id` + avatar/status/sign-off/guidelines/examples).
- M14 (access-control whitelist, invite-only admin gate): COMPLETE.
- M15 (test coverage): M15.1 (web jest) COMPLETE; M15.2 (admin jest) COMPLETE; M15.3 (E2E) — M15.3.1/.2/.5/.6 done; **M15.3.3/.4 specs written/committed/static-gate-clean, await a host Playwright run** (not runnable in-sandbox — see Gates).
- Real LLM chat drivers landed (OpenAI/Anthropic/Gemini over a shared SSE seam; env-selected, Echo fallback). SSE keep-alive-frame guard (LEARNINGS #24, DIRECTIVES #41).
- Tests: 1516 pass / 0 fail (shared 190, ui 234, db 9, ai 195, api 696, web 96, admin 96). E2E (host, live stack): last validated 20 passed / 3 fixme; new M15.3.3/.4/.5 specs drop fixme to 2 once host-run.
- Gates: run per-workspace (`turbo` SIGILLs here) — shared/ui/api build+eslint+jest, admin/web `tsc`+`next lint`, web+admin jest, e2e `tsc`+`eslint`, root `lint:css`+`knip` all clean. `next build` + `tsx` seed are arch-blocked in-sandbox. `.stylelintignore` shields `lint:css` from build output (LEARNINGS #25).
- **Sandbox cannot run the live E2E stack**: 4GB RAM OOMs it AND the network policy blocks `host.docker.internal` (probe → "blocked by network policy"; `no_proxy` = localhost only). Host runs Playwright; sandbox writes specs + static gates (DIRECTIVES §3.4.1). Live-stack recipe + symlink-`.next`-to-/tmp workaround: LEARNINGS #22.
- Last commit (128748f): docs(directives) §3.4.1 — recorded the host.docker.internal network-policy block. Working tree clean; prior OWC-mount drift fully settled + committed (admin dashboard f500850, DIRECTIVES 128748f).

## Next tasks (all externally blocked — need a human/PM/host decision, not autonomous coding)
1. **Host-validate M15.3.3/.4/.5** — host must run the dev stack AND allowlist `host.docker.internal:3000-3002,9099` (or add to `no_proxy`); then run the E2E specs.
2. **M13.5.3/.4/.5 + M13.7.4** (voice-dimension widgets) — BLOCKED on a PM/schema decision. Flag to PM; do NOT invent the fields unilaterally.
3. **M11.4 / NT.3 / NT.4 / NT.5 / NT.6** — PM/legal human sign-offs.
4. (deferred) Phase 2/3 + OD#6 — start only on explicit direction.

## Reference (detail lives in progress-log.md)
- i18n core, web/admin test harnesses (`renderWithProviders`, `mockApi`), `useMediaQuery`, avatar/status-tone helpers, ds.css primitives (`.dark-card`/`.kanban`/`.review-pane`/`.verdict-card`): see progress-log entries M13.1, M15.1.1, M15.2.1.
- Rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
