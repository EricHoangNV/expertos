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
- Tests: 1525 pass / 0 fail (shared 190, ui 234, db 9, ai 195, api 702, web 99, admin 96). E2E (host): last 20 passed / 3 fixme (→2 after host-run of M15.3.3/.4/.5).
- **Security Cycle 2 Criticals REMEDIATED** (pending re-review): (a) stale whitelist roles → `AccessControlService` writes through `users.role` + `AdminSessionService` 403 downgrade (DIRECTIVES #42, LEARNINGS #26); (b) expert-voice knowledge boundary → `PgVectorStore` joins `document_versions→documents` admitting `expert_id=$selected OR NULL`, `expertId` threaded chat→retrieval + forked into retrieval cache key, `IngestionInput.expertId`→`Document.expert_id` attribution (DIRECTIVES #43, LEARNINGS #27).
- Gates: run per-workspace (`turbo` SIGILLs here) — shared/ui/api build+eslint+jest, admin/web `tsc`+`next lint`, web+admin jest, e2e `tsc`+`eslint`, root `lint:css`+`knip` all clean. `next build` + `tsx` seed are arch-blocked in-sandbox. `.stylelintignore` shields `lint:css` from build output (LEARNINGS #25).
- **Sandbox cannot run the live E2E stack**: 4GB RAM OOMs it AND the network policy blocks `host.docker.internal` (probe → "blocked by network policy"; `no_proxy` = localhost only). Host runs Playwright; sandbox writes specs + static gates (DIRECTIVES §3.4.1). Live-stack recipe + symlink-`.next`-to-/tmp workaround: LEARNINGS #22.
- Last task: remediated the Security Cycle 2 Critical "expert voice is not a knowledge boundary" (expert-scoped retrieval + attribution; api 698→702 tests).

## Next tasks — work the open review FAIL findings (actionable in-sandbox); detail in FEEDBACKS.MD
1. **Security Cycle 2 — remaining FAIL** (all in-sandbox codeable): `document_upload` entitlement not enforced (add `@RequiresEntitlement` to `POST /uploads`) · raw GCS upload objects not deleted on retention/user-deletion (`StorageProvider.delete*`) · TidyCal fallback idempotency skips cancel/reschedule (fallback id = ref+type+timestamp).
2. **Product Cycle 1 FAIL** — citationless real-LLM answers bypass insufficient-knowledge: treat `built.citations.length===0` (non-refusal) as ungrounded → notice/concierge/recommendation/persistence.
3. **Host-validate M15.3.3/.4/.5** — host runs dev stack + allowlist `host.docker.internal:3000-3002,9099`.
4. **M13.5.3/.4/.5 + M13.7.4** voice-dimension widgets — BLOCKED on PM/schema decision; do NOT invent fields.
5. **M11.4 / NT.3-6** PM/legal sign-offs. (deferred) Phase 2/3 + OD#6.

## Reference (detail lives in progress-log.md)
- i18n core, web/admin test harnesses (`renderWithProviders`, `mockApi`), `useMediaQuery`, avatar/status-tone helpers, ds.css primitives (`.dark-card`/`.kanban`/`.review-pane`): see progress-log M13.1/M15.1.1/M15.2.1.
- Rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
