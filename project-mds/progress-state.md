# Progress

## Current State

Phase 1 (MVP) is functionally launch-ready. The open manifest `[ ]` items are externally blocked, BUT the **review FAIL verdicts (Security Cycle 2, Product Cycle 1) carry actionable in-sandbox code fixes** — that is the live work track now, not the blocked manifest.

- Phase 0 + Phase 1 backend/admin/expert (M1–M11): COMPLETE.
- M12 (consumer web `/chat` UI overhaul): COMPLETE (M12.1–M12.9).
- M13 (UI i18n EN+VI): COMPLETE. Web + admin each own `LocaleProvider`/`useT`; system content locale-aware; persist via `PATCH /me/locale`.
- M13 (admin/expert portal UI overhaul): DONE except voice-dimension widgets — M13.5.3/.4/.5, M13.5.6 fidelity, M13.7.4 `.voice-bar` DEFERRED (no schema backing; needs PM/schema decision). M13.5 ships schema-honest lean.
- M14 (access-control whitelist, invite-only admin gate): COMPLETE.
- M15 (test coverage): M15.1 (web jest) + M15.2 (admin jest) COMPLETE; M15.3 (E2E) — M15.3.1/.2/.5/.6 done; M15.3.3/.4 specs committed + static-gate-clean, await a host Playwright run.
- Real LLM chat drivers landed (OpenAI/Anthropic/Gemini over a shared SSE seam; env-selected, Echo fallback). SSE keep-alive-frame guard (LEARNINGS #24, DIRECTIVES #41).
- Tests: 1521 pass / 0 fail (shared 190, ui 234, db 9, ai 195, api 698, web 99, admin 96). E2E (host, live stack): last validated 20 passed / 3 fixme; new M15.3.3/.4/.5 specs drop fixme to 2 once host-run.
- **Security Cycle 2 Critical "stale admin/expert roles survive whitelist removal" REMEDIATED** (pending re-review): `AccessControlService.remove`/`updateRole` now write through `users.role` (the mirror `RolesGuard` reads), + `AdminSessionService` 403 path downgrades stale elevated roles. DIRECTIVES #42, LEARNINGS #26.
- Gates: run per-workspace (`turbo` SIGILLs here) — shared/ui/api build+eslint+jest, admin/web `tsc`+`next lint`, web+admin jest, e2e `tsc`+`eslint`, root `lint:css`+`knip` all clean. `next build` + `tsx` seed are arch-blocked in-sandbox. `.stylelintignore` shields `lint:css` from build output (LEARNINGS #25).
- **Sandbox cannot run the live E2E stack**: 4GB RAM OOMs it AND the network policy blocks `host.docker.internal` (probe → "blocked by network policy"; `no_proxy` = localhost only). Host runs Playwright; sandbox writes specs + static gates (DIRECTIVES §3.4.1). Live-stack recipe + symlink-`.next`-to-/tmp workaround: LEARNINGS #22.
- Last task: remediated the Security/Architecture Cycle 2 Critical above (whitelist→API privilege revocation; api 696→698 tests).

## Next tasks — work the open review FAIL findings (actionable in-sandbox); detail in FEEDBACKS.MD
1. **Security Cycle 2 — remaining FAIL** (all in-sandbox codeable): expert-voice knowledge boundary (join chunks→document_versions→documents, filter `expertId`; needs scope-policy default) · `document_upload` entitlement not enforced (add `@RequiresEntitlement` to `POST /uploads`) · raw GCS upload objects not deleted on retention/user-deletion (`StorageProvider.delete*`) · TidyCal fallback idempotency skips cancel/reschedule (fallback id = ref+type+timestamp).
2. **Product Cycle 1 FAIL** — citationless real-LLM answers bypass insufficient-knowledge: treat `built.citations.length===0` (non-refusal) as ungrounded → notice/concierge/recommendation/persistence.
3. **Host-validate M15.3.3/.4/.5** — host runs dev stack + allowlist `host.docker.internal:3000-3002,9099`.
4. **M13.5.3/.4/.5 + M13.7.4** voice-dimension widgets — BLOCKED on PM/schema decision; do NOT invent fields.
5. **M11.4 / NT.3-6** PM/legal sign-offs. (deferred) Phase 2/3 + OD#6.

## Reference (detail lives in progress-log.md)
- i18n core, web/admin test harnesses (`renderWithProviders`, `mockApi`), `useMediaQuery`, avatar/status-tone helpers, ds.css primitives (`.dark-card`/`.kanban`/`.review-pane`/`.verdict-card`): see progress-log entries M13.1, M15.1.1, M15.2.1.
- Rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
