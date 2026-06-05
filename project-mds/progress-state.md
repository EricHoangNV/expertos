# Progress

## Current State

Phase 1 (MVP) is functionally launch-ready. All in-sandbox-codeable review findings (Security Cycle 2 + Product Cycle 1) are REMEDIATED/ADDRESSED, pending re-review. Remaining open `[ ]` items are externally blocked (host E2E run, PM/legal sign-offs, schema decisions).

- Phase 0 + Phase 1 backend/admin/expert (M1–M11): COMPLETE.
- M12 (consumer web `/chat` UI): COMPLETE (M12.1–M12.9).
- M13 (UI i18n EN+VI): COMPLETE. Web + admin own `LocaleProvider`/`useT`; system content locale-aware; persist via `PATCH /me/locale`.
- M13 (admin/expert portal UI): DONE except voice-dimension widgets (M13.5.3/.4/.5, M13.5.6, M13.7.4 `.voice-bar`) — DEFERRED, no schema backing (PM/schema decision).
- M14 (access-control whitelist): COMPLETE.
- M15 (test coverage): M15.1 web jest + M15.2 admin jest COMPLETE; M15.3 E2E done in-sandbox (M15.3.1–.6); M15.3.7 = negative-space expansion (8 new tests, below).
- M16 (per-expert TidyCal calendar): COMPLETE in-sandbox (M16.1–.7). TidyCal has **no native webhooks** → per-expert **polling** of `GET /bookings` with each expert's AES-256-GCM-encrypted API token; `TidyCalProviderFactory`, `Consultation.expertId` attribution, expert/admin `calendar-settings` API + admin UI, backfill CLI. Webhook machinery deleted; offline-envelope seam disabled in prod. Host offline-E2E leg pending. LEARNINGS #36.
- Real LLM chat drivers landed (OpenAI/Anthropic/Gemini, shared SSE seam, env-selected, Echo fallback). SSE keep-alive guard (LEARNINGS #24, DIRECTIVES #41).
- M17 (runtime answer-tuning settings + real embedding provider): PLANNED, IN PROGRESS. **M17.1 DONE** — `AppSettings` Prisma model (global singleton, no RLS) + hand-written `20260605130000_app_settings` migration (explicit `app_user` GRANT) + `packages/shared/src/app-settings.ts` (`CHAT_MODELS` allowlist, `appSettingsUpdateSchema` temp∈[0,2]/floor∈[0,1], `AppSettingsDto`/`AppSettingsUpdateInput`). Next: M17.2 `SettingsService` + controller (clone `concierge-config`, 30s TTL cache).
- Tests (unit/jest): 1623 pass / 0 fail (shared 202, ui 235, db 9, ai 195, api 779, web 102, admin 101).
- E2E (Playwright, host): collects 36 tests / 18 files. Last full host run green at 20 pass / 3 fixme; the +9 added tests are tsc+eslint+collection clean, host-run pending.
- Security Cycle 2 (5) + Product Cycle 1 (High+3 Med) + Security Cycle 3 (1 Med) — all REMEDIATED in-sandbox, pending re-review. DIRECTIVES #42-48; LEARNINGS #26-34. (Detail in progress-log.)
- Security Cycle 4 + Product Cycle 2 (shared Critical+High+Med) — REMEDIATED in-sandbox: bulk-publish review-gate bypass (deleted `publish-drafts`; new `bulk-publish` CLI + shared `publishReviewedVersionTx` gate, `expert_review`-only, break-glass+approver+audit); TidyCal decrypt-fallback now skips+alerts (`failedTargets`) instead of polling the global calendar; bulk publish clears semantic cache. DIRECTIVES #50/#51; LEARNINGS #37/#38. Verdicts stay FAIL pending re-review.
- M15.3.7 E2E negative-space expansion: +8 tests (RLS isolation, citation trust-invariant, upload 402, concierge disclosure, conv→knowledge, voice publish, whitelist revocation, i18n persistence) + 3 fixtures. LEARNINGS #32 / DIRECTIVES #48.
- Gates: per-workspace build+eslint+jest, app tsc+next lint, root lint:css+knip clean. `next build` + `tsx` seed arch-blocked in-sandbox (LEARNINGS #25).
- **Sandbox cannot run live E2E** (4GB OOM + network policy blocks host.docker.internal); host runs Playwright (DIRECTIVES §3.4.1, LEARNINGS #22).
- **NT.3/NT.4 drafts in-repo** (`docs/legal/`): retention/deletion + high-stakes disclaimer copy; tasks stay `[~]` pending PM/legal sign-off (human gate).

## Next tasks
0. **Continue M17** (in-sandbox-codeable): M17.2 `SettingsService` + `app-settings.controller.ts` (`@Roles("admin")` GET/PATCH, 30s TTL cache bust-on-update, `SettingsModule`) → M17.3 thread temp+model through the LLM call (`LlmCallOptions`) → M17.4 retrieval score floor → M17.5 Admin Settings page → M17.6 OpenAI embedding provider + re-embed CLI → M17.7 cutover. M17.1 foundation (schema + shared types) is done.
1. **Host-run the E2E suite** incl. the M15.3.7 tests via `scripts/test-e2e-{users,admin}.sh` (expect ~28 pass / 2 fixme); fix any selector drift. Add the **M16 offline-E2E leg** (per-expert booking sync: offline envelope → consultation booked + attributed → cancel) and run `backfill-tidycal` on deploy + set `CREDENTIALS_ENCRYPTION_KEY`.
2. **Await Security Cycle 2 + 3 + 4 + Product Cycle 1 + 2 re-review** — all REMEDIATED/ADDRESSED in-sandbox.
3. **M13.5.3/.4/.5 + M13.7.4** voice-dimension widgets — BLOCKED on PM/schema decision; don't invent fields.
4. **M11.4 / NT.3-6** PM/legal sign-offs. (deferred) Phase 2/3 + OD#6.

## Reference (detail in progress-log.md)
- i18n core, web/admin test harnesses, ds.css primitives: progress-log M13.1/M15.1.1/M15.2.1.
- Rebuild `packages/ui` after changing it (apps consume `dist/`; ds.css ships from `src/`).
- E2E host-run recipe + NEXT_PUBLIC build-time gotcha: LEARNINGS #32, `scripts/test-e2e-*.sh`.
