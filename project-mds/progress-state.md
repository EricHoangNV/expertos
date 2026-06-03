# Progress

## Current State

Phase 1 (MVP) is functionally launch-ready. All in-sandbox-codeable review findings (Security Cycle 2 + Product Cycle 1) are REMEDIATED/ADDRESSED, pending re-review. Remaining open `[ ]` items are externally blocked (host E2E run, PM/legal sign-offs, schema decisions).

- Phase 0 + Phase 1 backend/admin/expert (M1–M11): COMPLETE.
- M12 (consumer web `/chat` UI): COMPLETE (M12.1–M12.9).
- M13 (UI i18n EN+VI): COMPLETE. Web + admin own `LocaleProvider`/`useT`; system content locale-aware; persist via `PATCH /me/locale`.
- M13 (admin/expert portal UI): DONE except voice-dimension widgets (M13.5.3/.4/.5, M13.5.6, M13.7.4 `.voice-bar`) — DEFERRED, no schema backing (PM/schema decision).
- M14 (access-control whitelist): COMPLETE.
- M15 (test coverage): M15.1 web jest + M15.2 admin jest COMPLETE; M15.3 E2E done in-sandbox (M15.3.1–.6); M15.3.7 = negative-space expansion (8 new tests, below).
- Real LLM chat drivers landed (OpenAI/Anthropic/Gemini, shared SSE seam, env-selected, Echo fallback). SSE keep-alive guard (LEARNINGS #24, DIRECTIVES #41).
- Tests (unit/jest): 1547 pass / 0 fail (shared 190, ui 235, db 9, ai 195, api 722, web 99, admin 97).
- E2E (Playwright, host): collects 36 tests / 18 files. Last full host run green at 20 pass / 3 fixme (pre-expansion 27); the +9 added tests are tsc+eslint+collection clean, host-run pending.
- **Security Cycle 2 — 5 findings REMEDIATED** (pending re-review): stale-whitelist role write-through + 403 downgrade; expert-voice knowledge boundary (`PgVectorStore` expert_id join + cache fork); `@RequiresEntitlement` on `POST /uploads`; raw-object deletion (`StorageProvider.delete` + `StorageModule`); TidyCal per-transition fallback eventId. DIRECTIVES #42-44,46,47; LEARNINGS #26-28,30,31. Re-audited 2026-06-03 — all present, no gaps.
- **Product Cycle 1 — High + 2 Mediums cleared** (pending re-review): citationless answers key off `built.citations.length===0` (DIRECTIVES #45, LEARNINGS #29); analytics "grounded" labels + "Citations resolved" badge (EN+VI). No FAIL/Medium in-sandbox code work remains.
- **E2E negative-space expansion (2026-06-03, M15.3.7):** +8 tests guarding recent fixes & untested negative space — cross-user isolation (RLS), citation trust-invariant, Free-plan upload 402, concierge consumer disclosure, conversation→knowledge surface, voice sign-off publish, whitelist revocation, i18n persistence. 3 idempotent fixtures added to `global-setup.ts`. Host-run via `scripts/test-e2e-{users,admin}.sh`. LEARNINGS #32 / DIRECTIVES #48 (NEXT_PUBLIC build-time E2E gotcha).
- Gates: per-workspace build+eslint+jest, app tsc+next lint, root lint:css+knip clean. `next build` + `tsx` seed arch-blocked in-sandbox (LEARNINGS #25).
- **Sandbox cannot run live E2E** (4GB OOM + network policy blocks host.docker.internal); host runs Playwright (DIRECTIVES §3.4.1, LEARNINGS #22).
- **NT.3/NT.4 drafts in-repo** (`docs/legal/`): retention/deletion + high-stakes disclaimer copy; tasks stay `[~]` pending PM/legal sign-off (human gate).

## Next tasks — in-sandbox-codeable work DONE; remaining = re-review + host runs + non-code + blocked
1. **Host-run the E2E suite** incl. the +8 M15.3.7 tests via `scripts/test-e2e-{users,admin}.sh` (expect ~28 pass / 2 fixme); fix any selector drift.
2. **Await Security Cycle 2 + Product Cycle 1 re-review** — all REMEDIATED/ADDRESSED in-sandbox.
3. **M13.5.3/.4/.5 + M13.7.4** voice-dimension widgets — BLOCKED on PM/schema decision; don't invent fields.
4. **M11.4 / NT.3-6** PM/legal sign-offs. (deferred) Phase 2/3 + OD#6.

## Reference (detail in progress-log.md)
- i18n core, web/admin test harnesses, ds.css primitives: progress-log M13.1/M15.1.1/M15.2.1.
- Rebuild `packages/ui` after changing it (apps consume `dist/`; ds.css ships from `src/`).
- E2E host-run recipe + NEXT_PUBLIC build-time gotcha: LEARNINGS #32, `scripts/test-e2e-*.sh`.
