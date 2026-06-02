# Progress

## Current State
- Completed:
  - M12.2.2: `ChatSearch` (`packages/ui/src/ChatSearch.tsx`) — dark-rail conversation search input (`.input` + magnifier, "Search all messages…") wired to M3.3 full-text search; debounced (≥2 chars) in `/chat`, results render under the field, selecting one loads that conversation's transcript
  - M12.2.1: `ChatSidebar` shell (`packages/ui/src/ChatSidebar.tsx`) — dark `.side` rail in the chat grid: ExpertOS wordmark + optional collapse + full-width "+ New conversation"; body/footer slots for M12.2.2–4; wired into `/chat` (clears active chat)
  - M12.1.3: Layout-direction switcher state (`packages/ui/src/layout.ts` — `LayoutDirection` classic/studio/focus + `layoutPanes`/`isLayoutDirection`/`LAYOUT_DIRECTION_INFO`); `ChatLayout` `direction` prop drops panes per direction + ds.css `.chat-layout-{classic,focus}` grid reflow; chat page owns the state (Tweaks control + localStorage is M12.7.2)
  - M12.1.2: `ChatLayout` component (`packages/ui/src/ChatLayout.tsx`) wrapping sidebar/main/rail over the M12.1.1 grid; integrated into `/chat` replacing the single-card layout (scrollable `.chat-content` main column)
  - M12.1.1: `.chat-layout` three-pane grid in ds.css (named areas; rail<1280px, sidebar<900px) + fixed pre-existing red lint gate from M12.8 login commit (login.css raw-px→rem/tokens, brand-hex SVGs eslint-disabled) — LEARNINGS #13
  - M11.1: Playwright E2E green vs live in-sandbox stack (16 pass/3 fixme/0 fail) — global-setup seeds users+roles+expert-voice, programmatic emulator sign-in, emulator-aware API Firebase init; CORS/a11y/selector fixes (LEARNINGS #9/#10/#11/#12)
  - M11 (harness): `infra/local-test-db.sh` + `pnpm test:integration` — pgvector in Docker; 50 live-DB tests green (15 RLS + 35 api)
  - M6.2 (web): Self-serve checkout CTA — `GET /me/plans` + account-page Upgrade/Manage-billing
  - NT.3 (technical): Data-retention sweeper (`RetentionService`) — preview/sweep expired uploads/idle convos/old logs + transcripts + anonymizes concierge records (PM approval pending)
  - M11.3: Cache hit/miss instrumentation + dependency-free `load/smoke.mjs` smoke harness (opt-in)
  - NT.4 (technical): High-stakes detector → disclaimer + topic-trigger CTA (PM/legal sign-off pending)
  - M10.4: Validation scorecard (activation/engagement/willingness-to-pay/funnel) — admin analytics
  - M10.3: Concierge volume/SLA/verdict metrics + knowledge-quality signals (admin analytics)
  - M9.3: Concierge async delivery (visible update vs silent) + transactional email
  - M9.4: Reviewer-feedback flywheel + escalate-to-consultation
  - M9.2: Concierge review queue + reviewer verdict/edit
  - M9.1: Admin concierge trigger config
  - M10.2: Consultation funnel + attribution
  - M10.1: Usage & cost analytics
  - M11.5: Design-system conformance audit; M11.2: /cso audit + rate limiter + prompt-injection hardening + live-DB authz/RLS tests
  - Consumer-web: upload UI, history+search+saved, answer affordances, plan & usage page
  - M8 (admin/expert): knowledge mgmt API+UI, failed-query/rec-rules/matrix/revenue, expert-roster+voice-profile UI, expert portal, TidyCal reconcile, audit+user mgmt+data deletion, publish-time cache invalidation
  - M7 (funnel): rec engine, book/maybe/ask actions, booking provider + reconciliation
  - M6 (subscriptions): entitlements+guard, Stripe billing, fair-use degradation, response caching, model pricing/cost
  - M5 (uploads): API+validation, storage+conversation-scoping, processing pipeline, retrieval+citation
  - M4 (citations): extraction, persistence+resolution, UI rendering
  - M3 (chat): SSE streaming, persistence, history+search, stream affordances, context window
  - M2 (voice): LLM provider abstraction, answer-prompt assembly, voice-profile CRUD, fidelity eval
  - M1 (knowledge): ingestion pipeline, hybrid retrieval (RRF), VI quality + NFC normalization
  - P0 (foundation): monorepo, Postgres+pgvector+RLS, Firebase Auth+RBAC, build/deploy, observability, design system
- Tests: 1055 pass / 0 fail / 0 skip (shared 179, ui 47, db 9, ai 161, api 659)
- Build: `pnpm build` builds all 7 workspaces (turbo-orchestrated — see SIGILL note below; build via turbo also affected in this sandbox). Admin standalone build flakily zeroes `.next/server/pages-manifest.json` — only matters for `next start`.
- Gates: typecheck ✅, test ✅ (coverage gate ≥90% met), lint ✅ (incl. stylelint), deadcode (knip) ✅. NOTE: `turbo` arm64 binary SIGILLs in this sandbox — run gates per-workspace (`tsc --noEmit`, `next lint`, `jest`) directly; `pnpm`-level turbo aggregation fails. (LEARNINGS #2/#13)
- Next tasks (priority order):
  1. **M12 (Frontend UI Overhaul)** — M12.1 shell + M12.2.1 sidebar + M12.2.2 search done. Next: M12.2.3 conversation list (history API + expert avatars + relative time; reuse `openConversation` from the chat page), M12.2.4 usage meter footer (`/me/entitlements`). Then M12.3 topbar, M12.4 messages, M12.5 sources rail, M12.6 input bar, M12.7 Tweaks panel. Read `requirements/ui-reference-spec.md` first.
  2. **M13 (Admin Portal UI Overhaul)** — sidebar/dashboard/kanban/matrix/voice/concierge rebuilds.
  3. **M11.1 fixme legs** / **NT human gates** — await external surfaces / PM sign-off.
