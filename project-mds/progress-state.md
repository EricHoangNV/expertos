# Progress

## Current State
- Completed:
  - M10.4: Validation scorecard (activation/engagement/willingness-to-pay/funnel) — admin analytics
  - M10.3: Concierge volume/SLA/verdict metrics + knowledge-quality signals (admin analytics)
  - M9.3: Concierge async delivery (visible update vs silent) + transactional email
  - M9.4: Reviewer-feedback flywheel + escalate-to-consultation
  - M9.2: Concierge review queue + reviewer verdict/edit
  - M9.1: Admin concierge trigger config
  - M10.2: Consultation funnel + attribution
  - M10.1: Usage & cost analytics
  - M11.5: Design-system conformance audit
  - M11: Live-DB integration tests (PgVectorStore, conversation search, expert store, failed queries, expert portal, semantic cache — 35 live tests)
  - M11.2: /cso security audit + per-IP rate limiter + prompt-injection hardening + live-DB authz/RLS tests
  - Consumer-web: document upload UI, chat history + search + saved-answers, answer affordances, plan & usage page
  - Admin: TidyCal reconciliation surface, audit + user management + data deletion
  - M8.5: Expert portal
  - M8.4: Admin expert-roster + voice-profile admin UI
  - M8.3: Failed-query inspector, recommendation-rules editor, entitlement matrix editor, revenue reports
  - Publish-time cache invalidation
  - M8.1 + M8.2: Knowledge management (API + admin UI)
  - M7.3: Booking provider + reconciliation
  - M7.2: Recommendation actions (book/maybe_later/ask_another)
  - M7.1: Recommendation evaluation engine
  - M6.5: Model pricing + usage cost tracking
  - M6.4: Response caching (in-process LRU + persistent + semantic)
  - M6.3: Fair-use entitlement enforcement + tier degradation
  - M6.2: Billing (Stripe integration + offline provider)
  - M6.1: Entitlements engine + guard
  - M5.4: Upload retrieval + citation
  - M5.3: Upload processing pipeline
  - M5.2: Upload storage + conversation scoping
  - M5.1: Upload API + file validation
  - M4.3: Citation UI rendering
  - M4.2: Citation persistence + resolution
  - M4.1: Citation extraction from LLM responses
  - M3.5: Conversation context window
  - M3.4: Answer stream affordances
  - M3.3: Conversation history + search
  - M3.2: Conversation persistence
  - M3.1: Chat controller + SSE streaming
  - M2.4: Voice fidelity evaluation
  - M2.3: Voice profile CRUD
  - M2.2: Answer prompt assembly
  - M2.1: LLM provider abstraction
  - P0.1: Monorepo + workspace setup
  - P0.2: Postgres + pgvector + RLS
  - P0.3: Firebase Auth + RBAC
  - P0.4: Manual build & deploy (Dockerfiles + Terraform + Cloud Run)
  - P0.5: Observability (structured logging, tracing, Sentry, usage logs)
  - P0.6: Design system foundation
  - M1.3: Vietnamese retrieval quality + NFC normalization
  - M1.2: Hybrid retrieval (vector + keyword RRF fusion)
  - M1.1: Versioned ingestion pipeline
- Tests: 997 pass / 0 fail / 0 skip (shared 179, ui 29, db 9, ai 149, api 631)
- Build: passing — `pnpm build` (turbo) builds all 7 workspaces.
- Gates: typecheck ✅, test ✅ (coverage gate met, 100%), lint ✅ (incl. stylelint), build ✅, deadcode (knip) ✅
- Next tasks (priority order):
  1. **M11.1** — Playwright E2E (needs live stack)
  2. **M11.3** — Load smoke (needs live stack)
  3. **M11.4 / NT** — Product/legal sign-offs (NT.3 data-retention, NT.4 disclaimers)
  4. Remaining Phase-0 Open Decisions (#3, product halves of #2/#6)
