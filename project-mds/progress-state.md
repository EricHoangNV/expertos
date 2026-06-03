# Progress

## Current State

Phase 1 (MVP) is functionally launch-ready. All in-sandbox-codeable review findings (Security Cycle 2 + Product Cycle 1) are now REMEDIATED/ADDRESSED, pending re-review. Remaining open manifest `[ ]` items are externally blocked (host E2E run, PM/legal sign-offs, schema decisions).

- Phase 0 + Phase 1 backend/admin/expert (M1–M11): COMPLETE.
- M12 (consumer web `/chat` UI overhaul): COMPLETE (M12.1–M12.9).
- M13 (UI i18n EN+VI): COMPLETE. Web + admin each own `LocaleProvider`/`useT`; system content locale-aware; persist via `PATCH /me/locale`.
- M13 (admin/expert portal UI overhaul): DONE except voice-dimension widgets — M13.5.3/.4/.5, M13.5.6 fidelity, M13.7.4 `.voice-bar` DEFERRED (no schema backing; needs PM/schema decision). M13.5 ships schema-honest lean.
- M14 (access-control whitelist, invite-only admin gate): COMPLETE.
- M15 (test coverage): M15.1 (web jest) + M15.2 (admin jest) COMPLETE; M15.3 (E2E) — all subtasks done in-sandbox. M15.3.3/.4 now `[x]`: specs written + fixtures seeded + committed + static-gate-clean + **DOM-selector-verified against the current admin pages**; only the host Playwright run remains (§3.4.1).
- Real LLM chat drivers landed (OpenAI/Anthropic/Gemini over a shared SSE seam; env-selected, Echo fallback). SSE keep-alive-frame guard (LEARNINGS #24, DIRECTIVES #41).
- Tests: 1547 pass / 0 fail (shared 190, ui 235, db 9, ai 195, api 722, web 99, admin 97). E2E (host): last 20 passed / 3 fixme (→2 after host-run of M15.3.3/.4/.5).
- **Security Cycle 2 — all 5 findings REMEDIATED** (pending re-review): 3 Criticals (stale whitelist roles→`AccessControlService` role write-through + `AdminSessionService` 403 downgrade; expert-voice knowledge boundary→`PgVectorStore` expert_id join + cache-key fork; document-upload entitlement→`@RequiresEntitlement` on `POST /uploads`) + 2 Highs (raw-object deletion→`StorageProvider.delete` + shared `StorageModule`, reclaimed post-commit by retention/user-deletion; TidyCal fallback idempotency→per-transition `fallback:<ref>:<type>:<stamp>` eventId). DIRECTIVES #42-44,46,47; LEARNINGS #26-28,30,31.
- **Product Cycle 1 — High + 2 Mediums cleared** (pending re-review): High = citationless real-LLM answers now key ungrounded off `built.citations.length===0` (not `facts.length`), threaded into done event + concierge + consultation (DIRECTIVES #45, LEARNINGS #29). Mediums (trust-signal wording) ADDRESSED = analytics "grounded" bucket labels its 2+/1/0 resolved-citation definition (badges+tooltips+`.qa-note` caption, EN+VI); chat "Verified" badge → honest "Citations resolved" (`verifiedLabel` prop, localized `chat.verifiedBadge`), Tweaks toggle aligned. **No FAIL/Medium in-sandbox code work remains in any review track.**
- Gates: run per-workspace (`turbo` SIGILLs here) — build+eslint+jest, `tsc`+`next lint` for apps, root `lint:css`+`knip` all clean. `next build` + `tsx` seed are arch-blocked in-sandbox (LEARNINGS #25).
- **Sandbox cannot run the live E2E stack**: 4GB RAM OOMs it AND the network policy blocks `host.docker.internal`. Host runs Playwright; sandbox writes specs + static gates (DIRECTIVES §3.4.1, LEARNINGS #22).

## Next tasks — all in-sandbox-codeable manifest work DONE; remaining is re-review + host runs + non-code + blocked
1. **Await Security Cycle 2 + Product Cycle 1 re-review** — all Security Cycle 2 (3 Critical + 2 High) + Product Cycle 1 (High + 2 Mediums) REMEDIATED/ADDRESSED in-sandbox, pending reviewer re-verification. No open in-sandbox-codeable review findings remain.
2. **Host-validate the E2E suite** (incl. the now-`[x]` M15.3.3/.4/.5) — host runs dev stack + allowlist `host.docker.internal:3000-3002,9099`; expected ~24 pass / 2 fixme.
3. **M13.5.3/.4/.5 + M13.7.4** voice-dimension widgets — BLOCKED on PM/schema decision; do NOT invent fields.
4. **M11.4 / NT.3-6** PM/legal sign-offs. (deferred) Phase 2/3 + OD#6.

## Reference (detail lives in progress-log.md)
- i18n core, web/admin test harnesses (`renderWithProviders`, `mockApi`), `useMediaQuery`, ds.css primitives: see progress-log M13.1/M15.1.1/M15.2.1.
- Rebuild `packages/ui` (`pnpm --filter @expertos/ui build`) after changing it — apps consume `dist/` (ds.css ships from `src/`, no rebuild).
