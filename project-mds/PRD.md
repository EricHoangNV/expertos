# ExpertOS — Product Requirements & Implementation Plan (PRD)

> **ExpertOS** — *AI-Powered. OPEX-Driven.*

## Task Manifest

> **How to use:** Scan this table to pick your next task. Read only the section (§) the task points to — do NOT read the full PRD.
> Status key: `[x]` = done, `[ ]` = open, `[~]` = partially done / blocked
> Sequence: Phase 0 → Phase 1 milestones M1–M11 (roughly in order; M9 is gated by Open Decision #5). Resolve the relevant Open Decision before building the milestone it blocks.

### Phase 0 — Foundation (§"Phase 0 — Foundation")
- [x] P0.1 `git init` + pnpm + Turborepo monorepo scaffold (`apps/web`, `apps/admin`, `apps/api`, `packages/shared`, `packages/db`, `packages/ai`, `packages/ui`, `infra/`)
- [x] P0.2 Postgres + pgvector via Prisma; tenant-ready schema + RLS migration (§"Data Model")
- [x] P0.3 Firebase Auth wiring (web + API token-verify guard, Google sign-in) + RBAC roles (user / expert / admin)
- [x] P0.4 Manual build & deploy: `pnpm` scripts (`test` with coverage gate, `build`, documented `gcloud run deploy`) + minimal scale-to-zero Terraform
- [x] P0.5 Observability baseline: structured logging, Sentry error tracking, request tracing, cost/usage logging tables
- [x] P0.6 Design system foundation: `ds.css` + Google Fonts in `packages/ui`, imported at both Next.js app roots; React primitives over the class components; Stylelint/ESLint guard failing on hardcoded colors / off-scale px (§"Design System")

### Phase 1 — MVP (§"Phased Delivery Roadmap")

#### M1 — Expert knowledge ingestion + retrieval
- [x] M1.1 Versioned ingestion pipeline: upload→GCS→parse (`Parser` contract)→chunk→summarize→embed→store as `document_versions` (seed/CLI loaded initially)
- [x] M1.2 Hybrid retrieval (vector + keyword + metadata filters: `status=published`, `tenant_id`, `scope`, language) behind `VectorStore` interface
- [x] M1.3 Resolve Open Decision #9 (Vietnamese retrieval quality) and add VI cases to eval set

#### M2 — Expert voice layer
- [x] M2.1 Voice profiles + runtime voice-example retrieval; voice-on-top-of-facts enforced in prompt builder
- [x] M2.2 Multiple selectable expert voices + attribution / "AI rendition of [Expert]" disclosure
- [x] M2.3 Expert sign-off workflow on own voice profile; language-aware voice (EN + VI)
- [x] M2.4 Voice-vs-facts separation tests; voice-fidelity assertion in eval harness (Open Decisions #2, #3, #6)

#### M3 — Chat experience — COMPLETE
- [x] M3.1 Chat UI with streaming + context-retaining follow-ups
- [x] M3.2 Conversation history + auto-titling + saved answers
- [x] M3.3 Full-text conversation search (message content, not just titles)
- [x] M3.4 Insufficient-knowledge path + graceful next step; answer feedback (👍/👎 + reason)
- [x] M3.5 Resolve Open Decision #8 (context-window / cost ceiling policy)

#### M4 — Citations — COMPLETE
- [x] M4.1 Citation builder with chunk-resolvability guarantee (never emit an unresolvable citation)
- [x] M4.2 Sources drawer + click-to-passage + `document_version_id` provenance (crimson `.cite` markers, render-after-resolve — §"Design System")
- [x] M4.3 Resolve Open Decision #7 (streaming vs citation-resolvability UX)

#### M5 — Document uploads — COMPLETE
- [x] M5.1 Query-time upload (PDF, XLSX, CSV, DOCX, MD, txt) with file-type/size validation + malware scan
- [x] M5.2 Temporary vs persistent modes (retention + indexing strategy per mode)
- [x] M5.3 Spreadsheet handling (sheets/tables/headers, row/col refs, real numeric values, sheet/table citations)
- [x] M5.4 Distinct upload citations (info-blue `.cite.upload` / `badge-info`, per §"Design System"); tenant/user upload isolation

#### M6 — Subscription system — COMPLETE
- [x] M6.1 Entitlement catalog + `plan_entitlements` matrix + `@RequiresEntitlement` guard + `/me/entitlements` (§"Paywall, Entitlements & Feature Gating")
- [x] M6.2 `PaymentProvider` abstraction (Stripe driver): checkout / customer portal / idempotent webhooks → entitlement sync + transaction ledger
- [x] M6.3 Transparent usage indicator (`.bar` quota meter; `.bar.warn` amber); fair-use thresholds + degrade-don't-block
- [x] M6.4 Caching layers (semantic → retrieval → answer)
- [x] M6.5 Resolve Open Decision #4 (unit economics → seed quota matrix)

#### M7 — Consultation funnel — COMPLETE
- [x] M7.1 Rule-based recommendation hooks (admin-configurable: topic, depth, low confidence, high intent)
- [x] M7.2 In-chat recommendation (Book / Maybe later / Ask another) + TidyCal booking + confirmation
- [x] M7.3 Resolve Open Decision #10 (TidyCal webhook reliability / missed-event recovery)

#### M8 — Admin & Expert portals
- [ ] M8.1 Admin: upload + versioned publish with expert-review gate (`Draft → AI Processing → Expert Review → Published`) — status as semantic `.badge` tones (§"Design System"); `.shell` shared with expert portal
- [ ] M8.2 Admin: conversation-to-knowledge pipeline (Mark Valuable → Draft → Expert Review → Publish)
- [ ] M8.3 Admin: plan-entitlement matrix editor + basic revenue reports (MRR, by plan/period) + failed/low-confidence query inspector
- [ ] M8.4 Admin: manage users / subscriptions / experts / voice profiles; admin audit logs; user-data deletion
- [ ] M8.5 Expert portal (first-class `expert` role): approve voice + knowledge, review AI answers, view consultation conversions

#### M9 — Concierge Mode (human-in-the-loop) — GATED by Open Decision #5
- [ ] M9.0 **GATE:** Open Decision #5 (Mode B legal/brand ruling) resolved — or fall back to Mode-A-only
- [ ] M9.1 Admin trigger config (off / user-prompted / auto-silent) + confidence threshold + SLA + volume cap
- [ ] M9.2 Concierge review queue in Expert portal; reviewer verdict (Good/Bad/Great) + edit
- [ ] M9.3 Async delivery (visible update vs silent) + transactional email notification
- [ ] M9.4 Reviewer-feedback flywheel: conversation-context injection (immediate) + `voice_examples`/`knowledge_drafts`/chunk-flagging (global); escalate-to-consultation

#### M10 — Analytics
- [ ] M10.1 Usage & cost analytics
- [ ] M10.2 Consultation funnel + attribution (question→conversation→recommendation→booking→revenue)
- [ ] M10.3 Concierge volume/SLA/verdict metrics + knowledge-quality signals
- [ ] M10.4 Instrument validation success criteria / kill line (Open Decision #1)

#### M11 — Hardening
- [ ] M11.1 Full E2E path matrix (Playwright) — see §"Testing Strategy"
- [ ] M11.2 Security tests (authz/RLS negative, prompt-injection regression, rate-limit) + `/cso` audit
- [ ] M11.3 Performance / caching tuning + load smoke test
- [ ] M11.4 Non-Technical Requirements sign-offs cleared (see manifest section below) — blocking before launch
- [ ] M11.5 Design-system conformance audit (`/design-review`): token usage (no hardcoded colors/px), citation render-after-resolve, upload-vs-knowledge color distinction, badge tones, hit-target/size minimums (§"Design System")

### Open Decisions (§"Open Decisions") — resolve before the milestone each blocks
- [ ] OD#1 Validation success criteria & kill line — blocks M10 / go-no-go (PM, Phase 0)
- [ ] OD#2 Voice-fidelity acceptance bar — blocks M2 (PM + Expert, Phase 0)
- [ ] OD#3 Voice profile cold-start workflow — blocks M2 (Eng + Expert, Phase 0)
- [x] OD#4 Unit economics: cost per answer vs price — blocks M6 seed matrix (PM + Eng, Phase 0) — RESOLVED in M6.5 (per-token cost model in `observability/model-pricing.ts` → real `cost_micros` on every usage row; calibrated seed quota matrix: Free 10/mo, Plus 200/mo hard cap, Premium softLimit 500/mo→degrade so worst-case ≈ break-even; see §"Open Decisions" #4)
- [ ] OD#5 Concierge Mode B legal/brand ruling — blocks M9 (Legal + PM, **before M9**)
- [ ] OD#6 Eval golden-set ownership, size, refresh — blocks M2 / M4 (Eng lead, Phase 0)
- [x] OD#7 Streaming vs citation-resolvability UX — blocks M3 / M4 (Eng + Design, early M3) — RESOLVED in M4.3 (stream prose, defer markers; render-after-resolve, server-side resolvability, click-to-passage; see §"Open Decisions" #7)
- [x] OD#8 Conversation context-window / cost ceiling policy — blocks M3 (Eng, early M3) — RESOLVED in M3.5 (token-budget window, deterministic/offline; LLM summarization deferred; see §"Open Decisions" #8)
- [x] OD#9 Vietnamese retrieval quality — blocks M1 (Eng, M1) — RESOLVED in M1.3 (cross-lingual default + mandatory NFC normalization; see §"Open Decisions" #9)
- [x] OD#10 TidyCal webhook reliability / missed-event recovery — blocks M7 (Eng, M7) — RESOLVED in M7.3 (raw-body HMAC verify → idempotent `booking_webhook_events` ledger keyed `[provider, eventId]`; correlate by `bookingRef` then booking email → user's pending `recommended` consultation; admin `reconcile` poll for missed-event recovery; unmatched bookings kept `matched=false` so nothing vanishes; see §"Open Decisions" #10)

### Non-Technical Requirements (§"Non-Technical Requirements") — pre-launch sign-offs, blocking
- [ ] NT.1 Legal/brand sign-off on Concierge Mode B disclosure (or confirm Mode-A-only launch)
- [ ] NT.2 Per-expert written sign-off on voice profile + first/third-person rendition policy
- [ ] NT.3 Data-retention + deletion policy reviewed and published
- [ ] NT.4 High-stakes-topic disclaimers + consultation-routing reviewed
- [ ] NT.5 Plan pricing & fair-use limits finalized with PM, stated in plain language at purchase
- [ ] NT.6 Payment/billing terms (refunds, cancellation, proration) approved + reflected in Stripe config + UI copy

### Phase 2 — Retention & Engagement (§"Phase 2 — Retention & Engagement") — not started
- [ ] Deferred: CI/CD pipeline, mobile (React Native), notifications, voice/TTS, folders/export, follow-up suggestions, confidence indicator, personalized memory, persistent user/customer knowledge, consultation depth, reconciliation dashboard

### Phase 3 — Scale & Enterprise (§"Phase 3 — Scale & Enterprise") — not started
- [ ] Deferred: B2B multi-tenant activation, expert marketplace, team workspaces, SSO, native booking, ingestion expansion, integrations, self-hosted models

---

## Context

We are building **ExpertOS** — a **web-first AI expert-knowledge product** (*AI-Powered. OPEX-Driven.*) — from scratch (the repo currently holds only requirements docs — no code, no git). The product is positioned not as a notes/search tool but as a **digital scaling layer for established expert brands**: users "talk to a scaled version of a named expert they already trust," get **grounded, cited** answers in that **expert's voice**, and are funneled toward **paid human consultations**. The core moat = Expert Knowledge + Expert Voice + Customer Context + Human Consultation.

This PRD combines the two feature lists into one prioritized roadmap, breaks delivery into phases (Phase 1 = MVP web app for users + admin), and bakes in the four cross-cutting mandates: **security-first**, **scalable architecture where cost grows with usage (no full infra on Day 1)**, **tiered test coverage** (95%+ on critical business logic, 70–80% overall — see Testing Strategy), and **end-to-end test suites covering all paths**.

### Strategic risk & validation focus (from PRD review)
The biggest risk is **not technical** — it is building too many platform capabilities before validating the core hypothesis: **"Will users pay to interact with a digital version of Expert X?"** Phase 1 is therefore sequenced to prove the Expert → Knowledge → Voice → AI → Consultation loop and willingness-to-pay first; broader platform optimization (reconciliation dashboards, B2B, marketplace) is deliberately pushed later. Everything below serves validating that loop before scaling it.

### Locked decisions (from planning Q&A)
- **Backend:** NestJS (framework on the Node.js runtime) in a single **TypeScript monorepo**, **hybrid-ready** — ingestion/parsing sits behind a `Parser`/job contract so a Python worker can be slotted in later for just spreadsheets/PDFs if TS parsing quality falls short.
- **Auth:** **Firebase Auth** (managed; offloads password storage, MFA, session security; integrates with GCP and the future mobile app). **Phase 1 = Google sign-in only**; email/password and other providers are a later config toggle. The backend token-verify guard is provider-agnostic, so adding providers later touches zero backend code.
- **Tenancy:** **Consumer-first, tenant-ready schema** — ship a consumer app (multiple selectable expert voices, temporary uploads, user-private context) but bake `tenant_id` + knowledge-scope columns into every table now, so B2B isolation is a later config layer, not a migration.
- **AI orchestration:** **Thin custom layer over provider SDKs** (OpenAI / Anthropic / Gemini) + pgvector, behind a small provider-abstraction interface. Full control over prompts, citation-to-chunk fidelity, grounding, and cost — citation integrity is the make-or-break feature in this category.
- **CI/CD:** Phase 1 ships with **manual build & deploy**; the automated CI/CD pipeline is deferred to Phase 2. Test suites + the 90% coverage threshold still run (locally / pre-push) in Phase 1.
- **Payments:** **Stripe** in Phase 1, behind a swappable `PaymentProvider` abstraction; revenue is mirrored into our own ledger for in-app reporting/reconciliation.

### Guiding product principles (from research)
1. **Citation trust is make-or-break.** Every citation must resolve to a real retrieved chunk before display. Prefer "no citation + honest uncertainty" over a guessed one.
2. **Honest uncertainty is a feature**, not a failure — say "I don't know, here's why" + a graceful next step (rephrase / book consultation).
3. **"Unlimited" is a trap word** — never hard-stop a paying user mid-task; always show usage state before the wall; state fair-use limits in plain language at purchase.
4. **Source disclosure beats algorithm aversion** — always show which named expert + what knowledge grounds an answer.
5. **Voice is the product, separated from facts** — retrieval/citations own facts; voice owns tone/structure/framing. Voice must never rewrite a cited number or claim.
6. **Spreadsheet/structured-data Q&A is a competitor weak spot** — treat as a flagship feature with real test coverage.
7. **Conversation search/organization rots in every competitor** — build full-text history search + good auto-titling from the start.
8. **The UI is a trust surface — design is not decoration.** All UI is built against the design system (`requirements/Design System.md` spec + `requirements/ds.css` source-of-truth): one crimson primary action per view, **info-blue for uploaded sources vs crimson for published knowledge**, mono for metadata, and citation markers that render *only after* they resolve to a real chunk. See §"Design System".

---

## Combined & Prioritized Feature Plan

Merged from `feature_list_1.md` (MoSCoW) and `feature_list_2.md` (scored matrix). Where they differ, the more aggressive placement wins **only** when both the value and the architectural cost justify it. The notable cross-list agreement: **voice layer + multiple expert voices + customer-knowledge retrieval are pulled into Phase 1.**

### Phase 1 — MVP (Must-have / Tier 1A + 1B)
**Core Q&A loop**
- Natural-language chat entry with context-retaining follow-ups
- **Streaming responses** (baseline 2026 expectation)
- RAG grounded in **published expert knowledge only**
- **Inline citations that link to the exact source passage** (click-to-passage), verifiable against retrieved chunks — never fabricated
- Sources drawer / "view sources" panel
- Explicit **"insufficient knowledge"** behavior + graceful next step
- Answer feedback (👍/👎 + optional reason) → feeds admin quality review

**Expert voice layer (the differentiator — pulled into Phase 1)**
- Per-expert voice profile (tone, directness, structure, terminology, examples, do/don't rules, level of detail)
- Runtime voice-example retrieval (embed + retrieve similar expert-authored answers per topic)
- Voice applied **on top of** grounding, never overriding facts
- **Multiple selectable expert voices from launch** ("Ask Expert A" vs "Ask Expert B")
- Expert-attributed answers + clear **"AI rendition of [Expert]"** disclosure
- Expert sign-off workflow on their own voice profile (admin)
- Language-aware voice (English + Vietnamese)

**Document-assisted Q&A**
- Query-time upload: PDF, XLSX, CSV, DOCX, Markdown, plain text
- **Proper spreadsheet handling** (sheets/tables/headers, row/col refs, real numeric values, cite sheet/table location)
- Answers cite uploaded-file sections distinctly from expert-knowledge citations
- **Explicit Temporary vs Persistent upload modes** with different retention + indexing strategies:
  - **Temporary** (KPI spreadsheet, financial report, one-time analysis) — default; short configurable retention; transient chunks scoped to the question/session; not indexed into searchable knowledge.
  - **Persistent** (SOP, workflow, internal docs, training material) — goes through customer-knowledge ingestion + indexing under `tenant_customer`/`user_private` scope (full activation in Phase 2; the mode + data model are in place from Phase 1).
- Tenant/user isolation on all uploads; excluded from global knowledge unless explicitly approved

**History & retention**
- Conversation history that persists and is reliably retrievable
- **Good auto-titling** of conversations (meaningful title from first exchange + rename)
- Saved answers / bookmarks
- **Full-text search across conversation content** (moved into Phase 1 per review — low cost, high user value; searches message content, not just titles)

**Accounts, subscription & fair use**
- Firebase **Google sign-in** (email/password deferred to a later phase), secure sessions
- Stripe subscription purchase & management; webhook-driven entitlement sync
- **Config-driven entitlements + paywall** (see "Paywall, Entitlements & Feature Gating" below) — one guard, one admin-editable matrix
- **Transparent usage indicator** (quota shown before the wall); honest degradation messaging
- Plain-language plan descriptions incl. fair-use limits

**Consultation funnel**
- AI-triggered in-chat consultation recommendation (Book / Maybe later / Ask another)
- Rule-based hooks (topic, conversation depth, low confidence, high-intent) — admin-configurable
- TidyCal booking link/embed; backend records booking reference; confirmation to user

**Concierge Mode (human-in-the-loop) — validate before automating**
A configurable safety net: when the AI is low-confidence, a human expert/associate can step in. Lets us launch with *good-enough* automation and have humans cover the gaps (the review's "do things that don't scale" thesis), while every human touch feeds the knowledge + voice flywheel.
- **Admin-configurable trigger mode** (global and/or per-expert):
  - **Off**
  - **Mode A — User-prompted:** on low confidence, the chat offers *"Would you like our team to review this?"* → user opts in → queued.
  - **Mode B — Auto-silent (shadow review):** on low confidence, the user still sees a normal AI answer (no prompt), while the answer is quietly queued for human review behind the scenes. The reviewer's improved answer is pushed back into the conversation as a refined update and/or feeds future answers.
- **Configurable confidence threshold** that fires the trigger; **configurable SLA** (default 24h) with live status to the user (*"a human is reviewing — we'll email you"*); **volume cap** so the expert team isn't swamped.
- **Async delivery:** the reviewed answer lands back in the conversation + a transactional email notification (Phase-1 email; push in Phase 2).
- **Distinct from consultations:** concierge = async, text, light-touch review of *one answer* (a premium perk); consultation = scheduled, paid, live, deep. A reviewer can **escalate** a concierge case into a paid consultation booking.
- **Reviewer feedback loop (improves the next answer):** when a reviewer rates an answer **Good / Bad / Great** or **edits** it:
  - *Immediate (same conversation):* the corrected answer is injected into conversation context so the next turn reflects it.
  - *Global (future questions):* **Great/edited answers become voice examples + knowledge drafts** (→ Expert Review → published); **Bad flags the source chunks** for the knowledge-gap inspector — so semantically-similar future questions retrieve the improved, human-validated answer. This is the RAG + voice flywheel.
- **Entitlement-gated:** Mode A is a premium perk (matrix-configurable). Mode B runs as an internal quality process and can sample across plans (capped), since better answers benefit everyone and grow the knowledge base.

**Trust surface**
- Named-expert identity display (photo, bio, specialties) per answer
- Consistent first-person-vs-third-person rendition policy per expert

**Admin web portal**
- Upload Markdown/PDF; create/edit Markdown notes
- **Knowledge approval workflow with explicit expert review:** `Draft → AI Processing → Expert Review → Published` (+ Archived/Deprecated). Experts care about *knowledge* accuracy as much as voice accuracy — the expert sign-off gate covers both.
- **Knowledge versioning** — `document_versions` + `published_version_id` + change history; every answer records which published version generated it (provenance: what changed, who approved, which version produced this answer)
- **Conversation-to-Knowledge pipeline** — `Conversation → Mark Valuable → Draft Knowledge → Expert Review → Publish`; captures recurring questions and grows the knowledge base from real usage
- Manage tags/topics, consultation types, experts, voice profiles
- Manage users, subscriptions, fair-use flags
- **Plan-entitlement matrix editor** (set free vs paid features/quotas without a deploy)
- **Revenue: transaction ledger + basic revenue reports** (MRR, by plan/period). The full reconciliation dashboard moves to Phase 2 (Stripe already provides reconciliation for MVP).
- **Inspect failed / low-confidence queries** (drives content roadmap)
- Basic usage & cost analytics

**Expert portal (first-class `expert` role)**
- A dedicated, expert-scoped surface (own role, may share the admin app shell in Phase 1):
  - Review & approve their own voice profile + voice examples
  - Review AI-generated answers rendered in their voice
  - Approve knowledge (the Expert Review gate above)
  - **Concierge review queue** — respond to flagged low-confidence answers, rate **Good / Bad / Great**, edit, escalate to consultation
  - Review common user questions in their topics
  - View their consultation conversions

**Foundational security/privacy**
- Role-based access (user / **expert** / admin); encrypted storage; audit logs for admin & expert actions
- **User data deletion** (GDPR-style)

### Phase 2 — Retention & Engagement
- React Native mobile app (Firebase Auth carries over)
- Push / email notifications (answer-ready, consultation reminders, re-engagement)
- Voice input; "listen to this answer" (TTS)
- Folders/Spaces; export conversation/saved answer to Markdown/PDF (full-text search itself shipped in Phase 1)
- Suggested follow-up questions; "Simplify this" / level-of-detail control
- Confidence indicator on answers
- Personalized memory / user context (answers improve with history)
- **Persistent customer/user-private knowledge base — full activation** (uses the tenant-ready schema + persistent-upload mode established in Phase 1)
- Multi-scope upload chat (one doc / folder / knowledge + docs)
- View/manage upcoming consultations; reminders; **post-consultation summary & action items**
- Consultation credits; semantic/answer caching surfaced as speed; consultation funnel analytics
- **Revenue reconciliation dashboard** (our ledger vs provider, mismatch flagging) — graduates from the Phase-1 ledger + basic reports
- Image/screenshot upload as question context

### Phase 3 — Scale & Enterprise
- Full B2B multi-tenant activation (tenant onboarding, per-tenant customer-knowledge ingestion, role/permission matrix, tenant admin) — flips on the tenant-ready schema
- Expert marketplace mechanics (third-party onboarding, per-expert booking routing, revenue splits, discovery/ranking)
- Team workspaces; tenant knowledge sharing; SSO / enterprise auth
- Native booking engine (availability, rescheduling, payments, multi-expert routing)
- Knowledge ingestion expansion (ChatGPT/Claude export, Google Docs/Notion, web/YouTube crawlers, consultation transcript auto-import)
- Slack/Teams/email integration; shareable public answer links
- Self-hosted/local routing & summarization models; advanced personalization
- "Consensus of experts"

---

## Target Architecture (scales with usage; minimal footprint Day 1)

```text
Next.js User Web App ─┐
Next.js Admin Portal ─┤→ NestJS API (Cloud Run, scale-to-zero)
                       │     ├─ Auth guard (Firebase token verify) + RBAC
                       │     ├─ Entitlement + Fair-Use middleware
                       │     ├─ Question Router → Retrieval → Prompt builder → LLM provider abstraction
                       │     ├─ Citation builder (verifies chunk resolvability)
                       │     ├─ Consultation recommendation engine (rules)
                       │     └─ Caching (semantic / retrieval / answer)
                       │
                       ├─ Cloud SQL Postgres + pgvector  (metadata, chunks, embeddings, conversations, usage)
                       ├─ Memorystore Redis (rate-limit, fair-use counters, hot cache)  [add when needed]
                       ├─ GCS (raw / processed / published / archive knowledge + uploads)
                       ├─ Cloud Tasks / Pub/Sub → Cloud Run Jobs (ingestion: parse→chunk→summarize→embed)
                       └─ Stripe + TidyCal (webhooks)
```

**"No full infra Day 1" approach (cost grows with usage):**
- **Cloud Run scale-to-zero** for API, admin, and ingestion jobs — pay only on traffic.
- **pgvector inside the existing Postgres** for MVP (no separate vector DB); the retrieval layer is abstracted behind a `VectorStore` interface so swapping to Vertex AI Vector Search / Qdrant later is a driver change, not a rewrite.
- **Redis is optional at launch** — start with Postgres-backed counters + in-process LRU cache; introduce Memorystore when rate-limit/cache volume justifies it.
- **LLM/embedding providers behind one interface** so model choice is config-tunable for cost (cheap model for high-volume/fair-use-degraded users, premium model for normal usage).
- **Aggressive caching** (semantic question cache → retrieval cache → answer cache) to protect margin from day 1.

---

## Design System (UI source of truth — all UI conforms)

**Every screen in `apps/web` and `apps/admin` (incl. the expert portal) is built against the design system — `requirements/Design System.md` (the spec) + `requirements/ds.css` (the implementation, source-of-truth for every value).** No view ships with ad-hoc colors, fonts, spacing, or one-off components. The system is a light corporate look — **crimson + ink + sand on cool paper**, Sora / Public Sans / Spline Sans Mono.

**Brand reconciliation (ExpertOS, not J&P).** The product brand is **ExpertOS — *AI-Powered. OPEX-Driven.*** We adopt the design system's **visual language** (crimson + ink + sand on cool paper; Sora / Public Sans / Spline Sans Mono; the full component set) as the UI source-of-truth, but the **wordmark, logo lockup, and tagline are ExpertOS** — they override the `.logo` "J&P GLOBAL" lockup and the "Driven by Excellence" tagline in `ds.css` / `Design System.md`. The `.logo` component is restyled to the ExpertOS wordmark (keeping the crimson-accent treatment); tokens and components are otherwise used as-is. (If "J&P Global" is later defined as a specific expert/tenant brand rather than the product, revisit — for now ExpertOS is the single product identity.)

**How it's wired**
- `ds.css` + its Google Fonts import live in a shared **`packages/ui`** package, imported once at each Next.js app root; thin React primitives wrap the class-based components (`.btn`, `.card`, `.badge`, `.chip`, `.cite`, `.field`, `.table`, `.stat`, `.bar`, `.shell`) so both apps consume one system.
- **Theme via tokens, never hardcode.** Every color / space / radius / shadow is a `:root` custom property (`var(--red-600)`, `var(--s6)`, `--r-lg`, `--sh-sm`). Restyling overrides tokens, not component rules. Raw hex / off-scale px is a lint failure (see Testing Strategy).

**Non-negotiable UI rules (enforced in review + tests)**
- **Citation integrity is visual too:** a `.cite` marker renders **only after** it resolves to a real retrieved chunk — never flashed-then-removed. This is the front-end half of the citation-resolvability guarantee (§"Paywall…" / M4); **Open Decision #7 (streaming vs citation-resolvability) must resolve onto this behavior** (stream prose, render markers post-validation).
- **Source provenance by color:** uploaded / user-provided sources = **info-blue** (`.cite.upload`, `.badge-info`); published expert knowledge = **crimson** (`.cite`, `.badge-red`). This distinction holds everywhere uploads and knowledge coexist (M4, M5).
- **Status is always a `.badge` with the matching semantic tone** — Draft (ink) · AI Processing (info) · Expert Review (amber) · Published (green) · Low confidence (red). Don't invent colors (M8 publish workflow, concierge queue).
- **One crimson primary action per view; never a red or black background wash.** App background is always `--paper`; content sits on white `--surface`.
- **Metadata is mono** — versions, refs, timestamps, counts, keys, quota read as "system truth."
- **Usage/quota uses `.bar`** (crimson; `.bar.warn` amber) so the transparent usage indicator (M6) and fair-use degradation read consistently.
- **The `.shell` app frame** (248px ink-900 sidebar) is shared by the admin portal **and** the expert portal in Phase 1.
- **Accessibility / anti-slop:** body ≥ 15px, hit targets ≥ 44px; no gradient washes, no emoji, no rounded-corner + left-accent-border callouts.

The design system's own principles (citation integrity, source disclosure by color, honest trust surfaces) are deliberately the same make-or-break bets as this PRD's product principles — the UI is where they become visible to the user.

---

## Data Model (tenant-ready from day 1)

Single Postgres schema with **`tenant_id` + `scope` on every knowledge/content row** (default `tenant_id = 'global'`, scope ∈ `global_expert | shared_expert | tenant_customer | user_private | temporary_upload`). Consumer MVP uses `global_expert` + `temporary_upload` + `user_private`; B2B (Phase 3) flips on the rest with no migration.

Core tables (extending the requirements' list):
- **Identity/billing:** `users`, `experts`, `voice_profiles`, `voice_examples`, `plans`, `plan_entitlements`, `subscriptions`, `usage_counters`, `usage_logs`, **`transactions`** (revenue ledger: amount, currency, type, provider, provider_ref, status, occurred_at)
- **Knowledge (versioned):** `documents` (+ `published_version_id`), `document_versions` (immutable snapshots + `change_summary` + `approved_by` + `approved_at`), `chunks` (with `embedding vector`, `status`, `tenant_id`, `scope`, `document_version_id`), `citations` (record `document_version_id` for answer provenance), `topics/tags`
- **Conversations:** `conversations`, `messages` (record generating `document_version_id`s), `saved_answers`, `answer_feedback`, **`knowledge_drafts`** (conversation-to-knowledge pipeline: source conversation, draft content, status)
- **Concierge:** `human_review_requests` (message_id, user_id, assignee/expert_id, `trigger_mode` = `user_prompted` | `auto_silent`, `visibility` = `visible` | `silent`, confidence_score, status [requested→in_review→answered→escalated→dismissed], sla_due_at, claimed_at, answered_at), `review_responses` (reviewer `verdict` = `good` | `bad` | `great`, original_answer, revised_answer, edited, delivered_to_user, notes) — feed `voice_examples` + `knowledge_drafts` + retrieval signals
- **Uploads:** `uploaded_files` (+ **`mode` = `temporary` | `persistent`**, retention policy, tenant/user isolation), `upload_chunks`
- **Consultation:** `consultations`, `consultation_types`, `consultation_recommendations`, `consultation_notes`
- **Cache:** `semantic_cache` (normalized question, embedding, chunk IDs, answer, citation IDs, model, ts)
- **Security/audit:** `admin_audit_logs`, `data_deletion_requests`, `fair_use_flags`

Row-Level Security (Postgres RLS) policies keyed on `tenant_id`/`user_id` are written now (enforced even though MVP is single-tenant) so the isolation guarantee is structural, not application-only.

---

## Paywall, Entitlements & Feature Gating

**Principle:** what's free vs paid is **configuration (data), never code.** Gating lives in one place; an admin edits a matrix to change the business model with no deploy.

**Building blocks**
- **`plans`** — Free, **Plus ($4.99/mo)**, **Premium ($9.99/mo or $69.99/yr)**; Enterprise later. Each plan **+ billing interval** maps to its own payment-provider price ID (so Premium has two price IDs: monthly and annual).
- **`features` (entitlement catalog)** — one key per capability, each either **boolean** (access on/off, e.g. `document_upload`) or **metered** (limit + window, e.g. `ask_question: 20/month`).
- **`plan_entitlements`** — the matrix `plan × feature → {enabled, limit, window}`. Seeded from a code default, then **admin-editable in the portal**. This table *is* the free-vs-paid definition.
- **`subscriptions`** — user → active plan + status, synced from provider webhooks (payment source of truth = provider).
- **`usage_counters`** — user → feature → count in current window (Postgres now; Redis when volume justifies).

**Enforcement (single choke point)**
- A NestJS guard + decorator `@RequiresEntitlement('ask_question')` on each gated route:
  1. Resolve user's active plan (cached) → look up `plan_entitlements` for the feature.
  2. **Boolean disabled** → `402` with upgrade payload.
  3. **Metered** → check counter vs limit → allow + atomic-increment, OR (Free) `402` with upgrade options, OR (Premium fair-use) **degrade to cheaper model instead of blocking**.
- `/me/entitlements` endpoint returns remaining quota per metered feature → powers the **usage indicator** so the wall is never a surprise.

**Payment-provider abstraction (Stripe first, swappable)**
- All billing goes through a **`PaymentProvider` interface** (`createCheckoutSession`, `openCustomerPortal`, `verifyWebhook`, `parseEvent`, `cancelSubscription`). **Stripe is the only driver in Phase 1**, but no app code imports the Stripe SDK directly — swapping to Paddle / Lemon Squeezy / PayPal later is a new driver, not a rewrite.
- The provider is the payment **source of truth**; we mirror every event into our **own `transactions` + `subscriptions` tables** so reporting/reconciliation never depends on the provider's dashboard and survives a provider switch.

**Paywall flow (PCI offloaded to the provider)**
```
Gated action / quota reached
  → API 402 { reason, feature, currentPlan, upgradeOptions, remainingQuota }
  → Frontend upgrade modal (only at boundaries; usage shown beforehand — never a surprise mid-task)
  → PaymentProvider.createCheckoutSession (hosted) → payment
  → Provider webhook (idempotent: checkout completed, subscription updated/deleted, invoice paid)
      → update subscriptions + entitlements + append to transactions (revenue ledger)
  → PaymentProvider.openCustomerPortal for manage/cancel
```

**Admin revenue management & reporting (Phase 1)**
- Local **revenue ledger** (`transactions`) populated from webhooks: amount, currency, plan, user, type (subscription/one-off/refund), provider, provider_ref, status, occurred_at.
- Admin dashboards: revenue overview (MRR, new vs churned, by plan, by period), transaction list/search, refunds, and a **reconciliation view** (our ledger vs provider) that flags mismatches — so finance can see revenue without logging into Stripe.

**Phase-1 launch pricing & default entitlement seed** (prices fixed; `ask_question` quota cells now calibrated to the Open Decision #4 unit-economics model — M6.5; all admin-tunable)

| | **Free** | **Plus** | **Premium** |
|---|---|---|---|
| **Price** | $0 | **$4.99 / mo** | **$9.99 / mo · $69.99 / yr** (~42% off annual) |
| Questions / month | none or very limited¹ | moderate allowance¹ | high fair-use cap → degrade, don't block |
| All expert voices | ✓ (the hook) | ✓ | ✓ |
| Cited answers + sources drawer | ✓ | ✓ | ✓ |
| Document-upload Q&A | ✕ / tiny limit | ✓ (limited) | ✓ (full) |
| Saved answers & history | limited | extended | unlimited |
| Answer model quality | standard | standard+ | premium |
| Consultation recommend + book | ✓ (revenue funnel) | ✓ | ✓ + included credit |
| Concierge human review (Mode A opt-in) | ✕ | ✕ / sampled | ✓ (configurable SLA) |

¹ Question allowances calibrated via Open Decision #4 (cost-per-answer vs. price, resolved in M6.5): Free 10/mo, Plus 200/mo (hard cap), Premium high cap → degrade past a 500/mo soft threshold. Admin-tunable without a deploy.

Key files: `apps/api/src/entitlements/` (catalog + guard + decorator + `/me/entitlements`), `apps/api/src/billing/` (`PaymentProvider` interface + Stripe driver + idempotent webhooks → entitlement sync + transaction ledger), `apps/api/src/revenue/` (reporting/reconciliation queries), `apps/admin/` plan-entitlement matrix editor + revenue dashboards.

---

## Security (a must — built in, not bolted on)

- **AuthN:** Firebase Auth; backend verifies Firebase ID tokens in a NestJS guard on every request. No custom password handling.
- **AuthZ:** Role-based (user / admin / expert) via NestJS guards + decorators; admin portal behind a separate role gate; Postgres RLS as defense-in-depth.
- **Tenant/user isolation:** every retrieval query carries scope filters (`status=published`, `tenant_id`, `scope`, language); uploaded docs isolated by `tenant_id`/`user_id`, excluded from global knowledge unless explicitly approved.
- **Secrets:** GCP Secret Manager; no secrets in code/env files; least-privilege service accounts per Cloud Run service.
- **Data protection:** encryption at rest (Cloud SQL + GCS default) + TLS in transit; signed, time-limited GCS URLs for uploads/downloads.
- **Input safety:** strict DTO validation (class-validator/Zod) on every endpoint; file-type/size validation + malware scan on uploads; parser sandboxing.
- **LLM trust boundary:** treat retrieved chunks + user uploads as untrusted; prompt-injection mitigation (delimiting, instruction hierarchy, output schema validation); never let model output drive privileged actions.
- **Abuse/fair-use:** per-user rate limiting, daily/monthly question + token/cost thresholds, bot/automation detection, account-sharing detection, automated throttling, manual-review flags for extreme usage.
- **Audit & privacy:** immutable admin audit logs; data-retention policy per upload scope; user-data-deletion endpoint + workflow; PII handling for consultation transcripts. **Concierge disclosure:** answers may be reviewed/edited by the expert team for quality (covers Mode B silent review) — disclosed in ToS/privacy and consistent with the "AI rendition of [Expert]" framing.
- **Liability:** scope/disclaimer handling for financial/legal/medical-adjacent topics; route high-stakes topics toward human consultation rather than confident AI answers.
- **Security gates:** dependency/secret scanning, SAST, and the `/cso` + `/review` skills — run locally/manually in Phase 1, wired into the CI pipeline in Phase 2.

---

## Testing Strategy (tiered coverage + E2E covering all paths)

**Tiered coverage (per PRD review — focus effort where bugs are expensive, not blanket 90% everywhere):**
- **Critical business logic: 95%+** — **entitlements, billing, retrieval, citations, security, consultation routing**. These get the highest-rigor unit + integration coverage.
- **Overall: 70–80%** — pragmatic baseline across the rest of the codebase.
- Per-path coverage thresholds enforced in the Jest config (a high gate on the critical packages/modules, a moderate global gate); run locally/pre-push in Phase 1, in CI from Phase 2.

- **Unit:** Jest for NestJS services + Next.js components/hooks. Heaviest focus on: entitlement/fair-use logic, citation builder (must never emit a citation that doesn't resolve to a retrieved chunk), retrieval scope filters, voice-vs-facts separation, billing/webhook handling, consultation + **concierge routing** (trigger thresholds, gating, SLA, feedback-loop application), parser outputs.
- **Integration:** Testcontainers-backed Postgres+pgvector; test ingestion pipeline, retrieval queries, RLS policies, payment/TidyCal webhook handlers (mocked providers), Firebase token verification.
- **E2E (all paths):** Playwright across both web apps. Path matrix includes: signup→ask→cited answer→save; insufficient-knowledge path; upload spreadsheet→numeric grounded answer→sheet citation; free→quota wall→upgrade→checkout; fair-use degradation messaging; consultation recommendation→TidyCal booking→confirmation; multi-expert voice selection; admin upload→process→review→publish→appears in user retrieval; admin unpublish→disappears; data deletion. Reuse the gstack `/qa` and `/browse` skills for live verification.
- **LLM/RAG eval harness:** golden-set Q&A fixtures asserting (a) citations resolve to real chunks, (b) voice-on vs voice-off accuracy is comparable (A/B, per expert), (c) low-confidence triggers fire when chunks are weak. Deterministic via seeded/mocked provider responses; periodic live eval out-of-band.
- **Security tests:** authz/RLS negative tests (user cannot read another user's uploads/conversations; non-admin cannot hit admin routes), prompt-injection regression fixtures, rate-limit tests.
- **Design-system conformance:** a Stylelint/ESLint rule fails the build on raw hex / off-scale px (token use is mandatory); component tests assert `.cite` markers render **only after** resolution and that uploaded sources use the **info-blue** treatment while published knowledge uses **crimson**; live visual QA via the gstack `/design-review` skill against `requirements/Design System.md`.

---

## Phased Delivery Roadmap

### Phase 0 — Foundation (1 sprint, enables everything)
1. `git init`; **pnpm + Turborepo monorepo** scaffold:
   ```
   apps/web (Next.js user)  apps/admin (Next.js)  apps/api (NestJS)
   packages/shared (DTOs/Zod types)  packages/db (Prisma schema + migrations)
   packages/ai (provider abstraction, retrieval, prompt builder)
   packages/ui (design system: ds.css + fonts + shared React primitives)
   infra/ (Terraform: Cloud Run, Cloud SQL, GCS, Secret Manager, IAM)
   ```
2. Postgres + pgvector via Prisma; full tenant-ready schema + RLS migration.
3. Firebase Auth wiring (web + API guard, Google sign-in); RBAC roles.
4. **Manual build & deploy** for Phase 1 (no CI/CD pipeline yet — deferred to Phase 2). Provide `pnpm` scripts: `test` (with the **90% coverage threshold enforced in the Jest config**, run locally/pre-push), `build`, and a documented manual `deploy` to Cloud Run (`gcloud run deploy`). Minimal Terraform — scale-to-zero everything.
5. Observability baseline: structured logging, error tracking (Sentry), request tracing, cost/usage logging tables.
6. **Design system foundation:** wire `ds.css` + Google Fonts into `packages/ui`, imported at both Next.js app roots; thin React primitives over the class-based components; a Stylelint/ESLint guard that fails the build on hardcoded colors / off-scale px. All later UI builds on this (§"Design System").

### Phase 1 — MVP (the bulk; milestones follow the review's recommended delivery sequence)
- **M1 Expert knowledge ingestion + retrieval:** versioned ingestion pipeline — upload→GCS→parse(`Parser` contract)→chunk→summarize→embed→store as `document_versions` — loaded via seed/CLI initially; hybrid retrieval (vector + keyword + metadata/`status=published`/scope filters). Proves the knowledge core before the full admin UI.
- **M2 Expert voice layer:** voice profiles + voice-example retrieval + multi-expert selection + attribution/disclosure + expert sign-off; voice-vs-facts separation enforced in prompt + tests.
- **M3 Chat experience:** chat UI with **streaming** + context-retaining follow-ups; conversation history + **auto-titling** + saved answers + **full-text conversation search**; insufficient-knowledge path; answer feedback.
- **M4 Citations:** **citation builder with resolvability guarantee** + sources drawer (click-to-passage) + `document_version_id` provenance.
- **M5 Document uploads:** query-time upload; **temporary vs persistent modes**; spreadsheet handling; distinct upload citations; retention + tenant/user isolation.
- **M6 Subscription system:** entitlement catalog + `plan_entitlements` matrix + `@RequiresEntitlement` guard + `/me/entitlements`; `PaymentProvider` abstraction (Stripe driver) — checkout/portal/idempotent webhooks → entitlement sync + **transaction ledger**; transparent usage indicator; fair-use thresholds + degradation; caching layers.
- **M7 Consultation funnel:** rule-based recommendation hooks (admin-configurable) + in-chat recommendation + TidyCal booking + confirmation.
- **M8 Admin & Expert portals:** full admin UI (upload, **versioned publish with expert-review gate**, **conversation-to-knowledge** pipeline, entitlement-matrix editor, **basic revenue reports**, failed/low-confidence query inspector, manage users/subs/experts/voice); first-class **Expert portal** (approve voice/knowledge, review answers, view conversions); audit logs; user-data deletion.
- **M9 Concierge Mode (human-in-the-loop):** **gated at start by Open Decision #5** (Mode B legal/brand ruling — with Mode-A-only as the clean fallback). admin trigger config (off / user-prompted / auto-silent) + confidence threshold + SLA + volume cap; concierge review queue in the Expert portal; reviewer verdict (Good/Bad/Great) + edit; async delivery (visible update vs silent) + email notification; **reviewer-feedback flywheel** → conversation-context injection (immediate) + `voice_examples`/`knowledge_drafts`/chunk-flagging (global); escalate-to-consultation.
- **M10 Analytics:** usage & cost; consultation funnel + **attribution** (question→conversation→recommendation→booking→revenue); concierge volume/SLA/verdict metrics; knowledge-quality signals.
- **M11 Hardening:** full E2E path matrix, security tests, `/cso` audit, performance/caching tuning, load smoke test. Plus the blocking **Non-Technical Requirements** sign-offs (see section below) before launch.

### Phase 2 — Retention & Engagement
**CI/CD pipeline** (GitHub Actions: lint, typecheck, unit 90% gate, integration via Testcontainers, build, auto-deploy to Cloud Run, secret/SAST scan) — graduating from Phase-1 manual deploys. Plus: Mobile (React Native), notifications, voice/TTS, conversation full-text search + folders + export, follow-up suggestions, confidence indicator, personalized memory, persistent user/customer knowledge, consultation depth (reminders, post-call summaries, credits), funnel analytics.

### Phase 3 — Scale & Enterprise
B2B multi-tenant activation, expert marketplace, team workspaces, tenant knowledge sharing, SSO, native booking, ingestion expansion, integrations, self-hosted models.

**Future opportunity dashboards (from review):**
- **Expert Performance Dashboard** — questions answered, consultation conversions, revenue generated, top-performing knowledge per expert.
- **Knowledge Coverage Dashboard** — common unanswered questions, low-confidence topics, missing knowledge areas (turns gap analysis into a content backlog).
- **Consultation Attribution** — full funnel from question → conversation → recommendation → booking → revenue (basic attribution starts in Phase 1 M9; this is the matured, expert/topic-segmented view).

---

## Critical Files / Modules to Create (Phase 0–1)

- `packages/db/prisma/schema.prisma` — tenant-ready schema + pgvector + RLS migrations
- `packages/ai/src/providers/` — `LlmProvider` + `EmbeddingProvider` interfaces + OpenAI/Anthropic/Gemini drivers
- `packages/ai/src/retrieval/` — `VectorStore` interface (pgvector driver), hybrid retriever, scope filters
- `packages/ai/src/prompt/` — prompt builder enforcing voice-on-top-of-facts + citation rules
- `packages/ai/src/citations/` — citation builder with **chunk-resolvability guarantee**
- `packages/ui/` — **design system**: `ds.css` (tokens + class-based components) + Google Fonts + shared React primitives (`Button`, `Card`, `Badge`, `Chip`, `Cite`, `Field`, `Table`, `Stat`, `Bar`, `Shell`); the single UI source-of-truth both Next.js apps consume (§"Design System")
- `apps/api/src/auth/` — Firebase guard (Google sign-in), RBAC decorators/guards (user / **expert** / admin roles)
- `apps/api/src/entitlements/`, `apps/api/src/fair-use/` — gating + throttling middleware
- `apps/api/src/ingestion/` — `Parser` contract + TS parsers (PDF/DOCX/XLSX/CSV/MD) + job consumers
- `apps/api/src/consultation/` — recommendation rules engine + TidyCal integration
- `apps/api/src/concierge/` — trigger modes (off / user-prompted / auto-silent), review queue + SLA + volume cap, reviewer verdict/edit, async delivery, feedback flywheel into voice/knowledge/retrieval
- `apps/api/src/billing/` — `PaymentProvider` interface + Stripe driver + idempotent webhooks → entitlement sync + transaction ledger
- `apps/api/src/revenue/` — revenue ledger reports (Phase 1) / reconciliation queries (Phase 2)
- `apps/api/src/knowledge/` — versioning (`document_versions`, `published_version_id`, provenance) + conversation-to-knowledge draft pipeline
- `apps/web/` — (built on `packages/ui`) chat UI (streaming), sources drawer, expert selector, usage indicator, upload (temp/persistent), full-text history search, **concierge review prompt + status + refined-answer update**, booking
- `apps/admin/` — (built on `packages/ui`, shared `.shell`) upload, versioned publish + **expert-review gate**, conversation-to-knowledge review, voice-profile editor + expert sign-off, failed-query inspector, plan-entitlement matrix editor, basic revenue reports, **concierge trigger config + review queue**, analytics; **expert-scoped portal views** (role-gated)
- `infra/` — Terraform for Cloud Run / Cloud SQL / GCS / Secret Manager / Cloud Tasks / IAM

---

## Open Decisions (resolve in Phase 0 / early Phase 1)

Unresolved questions surfaced in PRD review — each cheaper to settle now than after the relevant milestone is built. Owner + due are placeholders; assign before Phase 0 closes.

| # | Decision | Why it matters now | Blocks | Owner | Due |
|---|----------|--------------------|--------|-------|-----|
| 1 | **Validation success criteria & kill line** | The #1 risk ("will users pay to talk to a digital Expert X") has no number; without a target no one can say if the loop worked. | M10 / go-no-go | PM | Phase 0 |
| 2 | **Voice-fidelity acceptance bar** | Voice is *the product*; current tests only protect facts (voice-on ≈ voice-off), not "does this sound like the expert." | M2 | PM + Expert | Phase 0 |
| 3 | **Voice profile cold-start workflow** | ~50 seeded examples is referenced but not how they're produced or how many are "enough." On the critical path for every expert. | M2 | Eng + Expert | Phase 0 |
| 4 | **Unit economics: cost per answer vs. price** | Cost is logged, not modeled. Multi-call RAG on premium models + "high fair-use cap → degrade" can cost more per heavy user than the plan supports. | M6 seed matrix | PM + Eng | ✅ RESOLVED (M6.5) |
| 5 | **Concierge Mode B (silent review) legal/brand ruling** | A human silently editing an answer attributed to a named expert is the highest-liability mechanism in the app; rules differ by jurisdiction (VN + EU/US). | M9 | Legal + PM | **before M9** |
| 6 | **Eval golden-set ownership, size, refresh** | The harness is specified; the dataset isn't. A thin/stale golden set gives false confidence. | M2 / M4 | Eng lead | Phase 0 |
| 7 | **Streaming vs. citation-resolvability UX** | Verifying every citation before display conflicts with token streaming — citations could flash then vanish, or buffering kills the streaming feel. | M3 / M4 | Eng + Design | ✅ RESOLVED (M4.3) |
| 8 | **Conversation context-window / cost ceiling policy** | Long multi-turn chats grow the prompt unbounded — a correctness and cost risk. | M3 | Eng | ✅ RESOLVED (M3.5) |
| 9 | **Vietnamese retrieval quality (not just voice tone)** | i18n affects embeddings, chunking, and retrieval — deeper than answer styling. | M1 | Eng | ✅ RESOLVED (M1.3) |
| 10 | **TidyCal webhook reliability / missed-event recovery** | Booking confirmation depends on the webhook; a missed event leaves a booking in limbo. | M7 | Eng | **RESOLVED (M7.3)** |

**1. Validation success criteria & kill line** — the quantitative bar that means the hypothesis is validated, falsified, or needs a pivot (numbers PM-set): activation (% of new users reaching ≥1 cited answer in session 1); engagement (% returning within 7 days; median questions/active user/week); **willingness-to-pay** (free→paid %, trial→paid if any); funnel (recommendation→booking %, revenue per paying user); **explicit kill/pivot line** (e.g. *"if free→paid < X% and booking < Y% by [date], revisit pricing/positioning before scaling"*). Instrument in **M10** from day one; add chosen targets to §"Strategic risk & validation focus."

**2. Voice-fidelity acceptance bar** — what "sounds like the expert" means, measured, with a launch-blocking score: hold out the expert's **real** answers (not used in profile/examples); blind-rate expert-authored vs. app-rendered on a fidelity rubric (tone, structure, framing, terminology), ideally by the expert; set a per-expert **launch gate** (e.g. "expert can't distinguish > Z%" or "rubric ≥ N/5"). Add as a **third assertion** alongside voice-on ≈ voice-off in the RAG/voice eval harness.

**3. Voice profile cold-start workflow** — the repeatable process to stand up a new expert's voice from zero: source of examples (structured interview / past transcripts / published writing / mix); **minimum viable example count** to pass the §2 bar and how that's verified; **effort estimate per expert** (this is the unit of scaling the business); whether the Conversation-to-Knowledge + concierge flywheel is expected to improve the profile post-launch and how that's reviewed.

**4. Unit economics: cost per answer vs. price** — model an answer's cost (embedding, retrieval, optional rerank, generation in+out tokens, any concierge human time) and the **worst-case premium user/month** under "high fair-use cap → degrade": at what volume does a premium user go cost-negative, and does the degrade threshold protect margin? Feed into the **Phase-1 seed matrix** (the "Questions/month" cells are still placeholders) and the degrade trigger; cross-check the assumed cache-hit rate against realistic low early volume.

> **RESOLVED (M6.5).** Cost is now *modeled*, not just logged, and the seed matrix is calibrated to it. Decisions:
> 1. **A per-token cost model lives in `apps/api/src/observability/model-pricing.ts`** (`costMicrosFor(model, prompt, completion)`), keyed by the `model` string callers already log. `UsageLogService.record` stamps a real `cost_micros` on every usage row when the caller omits one (conversion: `micros/token = USD-per-1M-tokens × 100`, since `cost_micros` = millionths of a USD cent). This closes the "cost is logged, not modeled" gap — M10 analytics + billing reconciliation now have a margin signal, and a cache hit lands at an explicit `cost_micros = 0` (the cache/degrade win is visible in the ledger, not hidden as null).
> 2. **The modeled answer** ≈ 3,000 prompt + 600 completion tokens (system + ~8 retrieved chunks + voice + windowed history + question; ~500–600 out). Representative prod prices (USD / 1M tokens): standard $0.15/$0.60, premium $3/$15, degraded "mini" $0.05/$0.40, embedding $0.02. So a **standard answer ≈ $0.0008**, a **premium answer ≈ $0.018** (~20× standard), a **degraded answer ≈ $0.0008**. Embeds (~2 short ones/turn) are negligible. No rerank in Phase 1; concierge human time is an M9 cost, out of scope here.
> 3. **Worst-case premium user / does degrade protect margin?** Yes. Premium = $9.99/mo (net ≈ $9.39 after a ~$0.60 Stripe fee). A premium user goes cost-negative on the premium model at roughly **$9.39 / $0.018 ≈ 520 answers/mo**. The seed sets the **fair-use `softLimit` at 500/mo**: up to 500 answers run on the premium model (≈ $9.00), then **degrade** to the mini model (≈ $0.0008/answer) for the rest — so the heaviest premium user is ≈ **break-even, never deeply cost-negative**, and the median user (tens of answers) keeps a strong margin. The degrade threshold, not a hard cap, is what protects margin (PRD §Paywall "high fair-use cap → degrade, don't block").
> 4. **Seed quota matrix (calibrated, admin-tunable — `packages/db/prisma/seed.ts`):** Free **10**/mo (model cost ≈ $0.008/mo — volume isn't the constraint for Free; conversion is, and the hook is "all expert voices"), Plus **200**/mo hard cap (≈ $0.16/mo ≈ 4% of net — a comfortable "moderate allowance"; Plus does not degrade), Premium **`limit: null` + `softLimit: 500`**/mo (degrade past the threshold). The earlier placeholders (Free 5 / Plus 100 / Premium softLimit 1000) are retired.
> 5. **Cache-hit rate is NOT assumed for margin.** Early volume is low, so the cache hit-rate is low; the margin math above holds at a **0% hit rate**. Caching (M6.4) is pure upside — any hit costs $0 and improves the blended number, but the plan is solvent without it. When real volume + the real LLM/embedding driver land, update the rates + the modeled answer size in `model-pricing.ts` (the single source) and re-tune the soft threshold via the M8.3 matrix editor — no deploy needed for the threshold itself.

**5. Concierge Mode B legal/brand ruling — hard gate at start of M9** — obtain the legal + brand ruling on silently reviewing/editing answers attributed to a named expert **before M9 is built**: disclosure obligations across jurisdictions (VN + EU/US); accountability for a human-edited answer presented as the expert's; confirm ToS/privacy wording (PRD §Security) covers Mode B specifically; **fallback plan** — can the product launch with **Mode A only**, and is M9 sequenced so that's a clean fallback, not a rebuild? (Promoted from the M11 checklist to an M9-start gate.)

**6. Eval golden-set ownership, size, refresh** — make the golden set a real, owned dataset: a **named** owner (not "the team"); size target per expert and per topic; refresh cadence (especially when knowledge is re-published — versions change → expected answers may change); how **failed/low-confidence queries** (admin inspector) and concierge **"Bad"** flags feed back into it.

**7. Streaming vs. citation-resolvability UX** — likely resolution (confirm + spec): **stream the prose, render citation markers only after post-generation validation**, so a citation never appears then disappears; specify the placeholder/loading behavior for citations during streaming.

> **RESOLVED (M4.3).** The likely resolution above is **confirmed and adopted** — Eng + Design sign-off onto the behavior already built across M3.1 → M4.1 → M4.2 (no new code; this is the design ruling the three milestones were built to satisfy). Decisions:
> 1. **Stream the prose, defer the markers.** The token stream renders as plain prose; while a turn is in flight any `[n]` the model emits stays **inert plain text**, never a live `.cite` chip. Markers become interactive only after the stream's terminal `done` event. The placeholder/loading behavior for citations during streaming is therefore "the literal `[n]` text in the prose" — there is no spinner, skeleton, or provisional chip that could later vanish or renumber. (Web: `renderAnswer` in `apps/web/app/chat/page.tsx` gates on `resolved = message.done && message.citations.length > 0`; pre-`done` it renders `message.content` verbatim.)
> 2. **Resolvability is enforced once, server-side, on the complete answer.** The `@expertos/ai` `buildCitations({ answer, citations })` builder (M4.1) runs after the delta loop in `ChatService.answerStream`, strips unresolvable markers from the persisted text, and emits on `done` only the de-duped sources a surviving marker actually cited (keeping the model's true ordinal — never renumbering). The client never re-validates; it trusts the `done` payload. This is why a marker can never flash-then-disappear: it is never shown as a citation until the validated list exists.
> 3. **Render-after-resolve is also the rule on re-hydrated history.** The same gate applies to a conversation loaded from history — `ConversationService.get` re-hydrates `ChatMessageDto.citations` (M4.2 read path), so a stored answer renders its markers as `.cite` chips only where the persisted ordinal resolves; a dangling `[n]` can never appear because the persisted text was already sanitized at write time.
> 4. **Click-to-passage, not hover-preview, is the resolved interaction.** A resolved marker (and the matching sources-drawer row) is keyboard- and click-activable; activating it scrolls to and highlights (`.source.active`) the source row showing the quote + `document_version_id` provenance. This was chosen over an inline hover popover so the citation UX is identical on the live turn and in history, and is accessible without pointer hover.
> 5. **No buffering trade-off was needed.** Because validation is post-stream and markers are deferred rather than rendered-then-corrected, the streaming feel is preserved (prose streams token-by-token) **and** the integrity guarantee holds (no citation is ever shown before it resolves) — the two goals the decision framed as conflicting do not actually conflict under this split. If a future real LLM supports trustworthy mid-stream citation grammar, revisit; until then deferral is the safe default.

**8. Conversation context-window / cost ceiling policy** — truncation/summarization strategy for long chats: max turns/tokens carried before summarizing earlier turns; whether summarization is itself an LLM call and on which model; interaction with the concierge "inject corrected answer into context" mechanism (don't summarize away a human correction).

> **RESOLVED (M3.5).** Decisions:
> 1. **Bound the replayed context by an estimated-token budget, not a fixed message count.** `ConversationService.loadHistory` carries the most-recent user/assistant messages whose combined estimate fits `HISTORY_TOKEN_BUDGET` (1500 tokens). Token-bounding is what actually caps prompt size and per-answer spend — ten short messages and ten long ones cost very differently — so the interim `HISTORY_LIMIT = 10` message cap (M3.1) is retired.
> 2. **The estimate is deterministic and offline.** It reuses `estimateTokens` from `@expertos/ai` (the same word→token heuristic that sizes ingestion chunks), so windowing adds **zero LLM cost** and never makes a model call. When the real tokenizer lands it replaces that one helper and both ingestion and context-windowing move together.
> 3. **Whole messages, newest-first, always ≥ the latest message.** A message is kept in full or not at all (never half a turn); the single most-recent message is always carried even if it alone exceeds the budget, so an immediate follow-up never loses its antecedent. A hard `HISTORY_MAX_MESSAGES = 40` row ceiling backstops the DB read so a burst of tiny messages can't make the query scan unbounded rows.
> 4. **Summarization is deferred (documented seam, not built).** Truncation is the M3.5 policy. If LLM summarization of out-of-window turns lands later it must run on a cheap model and must **not** summarize away a concierge "inject corrected answer into context" edit (M9). Because the window keeps the *most recent* turns and a concierge correction enters as recent context, truncation of older turns is already safe for that mechanism today — the constants + comment in `conversation.service.ts` mark the spot.

**9. Vietnamese retrieval quality** — confirm the embedding + retrieval stack performs on Vietnamese, not just that answers can be styled in VI: does the embedding model retrieve well for VI queries against VI / mixed EN-VI knowledge; VI chunking behavior; whether retrieval is language-filtered, multilingual, or cross-lingual — and add VI cases to the eval golden set (§6).

> **RESOLVED (M1.3).** Decisions:
> 1. **Retrieval is cross-lingual / multilingual by default.** No language filter is applied unless a caller explicitly sets `filters.language`. Rationale: the production embedding model (OpenAI `text-embedding-3-small`) is multilingual, and experts hold mixed EN-VI knowledge — a hard language gate would stop EN knowledge from answering a VI question (and vice-versa), which is wrong for the product. `language` stays an *optional* narrowing filter for tenants that want it. The keyword path uses Postgres `'simple'` config (no English stemming) so VI lexemes aren't distorted.
> 2. **NFC normalization is mandatory at every text boundary** (the concrete engineering output). Vietnamese diacritics encode two visually-identical ways — NFC (precomposed) and NFD (decomposed combining marks). The combining marks are Unicode `Mark`, not `Letter`, so the letter/number tokenizer shatters a decomposed word (`"Việt"`→`["vie","t"]`, `"trưởng"`→`["tru","o","ng"]`): a query and a document in different forms share almost no tokens, silently destroying recall in **both** the vector (embedder tokenizer) and keyword (`to_tsvector`) paths. Fix: NFC-normalize at ingestion (chunk content), at embedding time, and at query time (`retrievalQuerySchema` transform). Verified by the eval harness's NFD-vs-NFC regression case.
> 3. **VI chunking** uses the same whitespace word-window splitter — correct for Vietnamese (space-separated syllables). The English-tuned word→token estimate *under*-counts VI sub-word tokens, so real chunks run slightly larger than the nominal budget; safe under the model's large token limit, revisited when the real tokenizer lands.
> 4. **Eval golden set:** a deterministic, offline RAG eval harness now lives in `@expertos/ai` (`evaluateRetrieval` + `RETRIEVAL_GOLDEN_SET`) reusing the production primitives (chunk → embed → cosine + keyword → RRF fuse). It ships EN, VI (NFC), mixed EN-VI, and the NFD-normalization regression case, and runs in CI with the offline hashing embedder to guard tokenization / normalization / fusion. The *semantic* VI quality number (true cross-lingual recall, which a lexical offline model cannot produce) is measured **out-of-band** against the real multilingual model using the same fixture format. Golden-set ownership / size / refresh cadence remains **Open Decision #6**.

**10. TidyCal webhook reliability / missed-event recovery** — how a booking reconciles if the confirmation webhook is missed: retry/idempotency (mirror the Stripe webhook discipline already in the PRD); a reconciliation path (poll TidyCal or manual admin link) so a booked-but-unconfirmed consultation doesn't silently vanish; user-facing state while confirmation is pending.

> **RESOLVED (M7.3).** The booking-confirmation path is the booking analog of the M6.2 Stripe webhook, mirroring its discipline exactly. Decisions:
> 1. **Swappable provider seam.** `TidyCalProvider` (the booking analog of `PaymentProvider`) — no app code talks to TidyCal directly. Offline default (`OfflineTidyCalProvider`, trusted-JSON envelope) keeps the whole book→webhook→consultation-sync + reconcile path runnable without TidyCal/network; the real `HttpTidyCalProvider` (HMAC-SHA256 raw-body verify + event parse + REST poll) swaps in behind the `TIDYCAL_PROVIDER` token when `TIDYCAL_WEBHOOK_SECRET` is set.
> 2. **Idempotency = a `booking_webhook_events` ledger** keyed `@@unique([provider, eventId])` (pre-check + P2002 catch, exactly the M6.2 `transactions` pattern). A redelivered webhook or a re-poll is a no-op. The webhook route is `@Public()` (verified by signature, not Firebase) and syncs in a **system RLS context** (`runAsSystem`, admin GUC) because there is no request principal.
> 3. **Correlation (the OD#10 concern — TidyCal links are static, so the event doesn't know which consultation it is):** match first by `bookingRef` (a follow-up reschedule/cancel for a booking we already linked), then by the booking **email** → the user's most-recent pending `recommended` consultation (the row M7.2 created at Book-click). A booking made outside the funnel still creates a `booked` consultation so it never vanishes.
> 4. **Missed-event recovery + no-vanish.** An admin-triggered `reconcile` (`POST /consultation-bookings/reconcile`, `@Roles('admin')`) polls TidyCal for recent bookings and replays each through the same idempotent apply — a dropped webhook is recovered. An event whose email matches no user is recorded `matched=false` (kept, never dropped) so an admin can reconcile it manually rather than the booking silently vanishing. The `consultations.status` itself is the user-facing pending state (`recommended` = booking opened/pending → `booked` = webhook-confirmed → `canceled`).
> 5. **M11 caveat:** seam-tested with a mocked tx (the real `booking_webhook_events`/`consultations` writes join the Testcontainers list); the `HttpTidyCalProvider` REST poll needs live network (deploy-time, like the Stripe `FetchStripeHttpClient`). The signature-verify + event-parse + param-construction logic IS fully unit-tested. The migration was validated against the live Postgres this session.

---

## Non-Technical Requirements (pre-launch sign-offs — blocking)

These are not code; they are legal / brand / policy gates that must be cleared before launch. Tracked here for later verification (the M11 hardening gate references this section).

- [ ] **Legal/brand sign-off on Concierge Mode B (silent review) disclosure** — final confirmation of the ruling made at the M9-start gate (Open Decision #5): ToS + privacy policy wording approved; "AI rendition of [Expert]" framing confirmed; accountability for human-edited answers attributed to a named expert defined. (If Mode B was disallowed, confirm launch is Mode-A-only.)
- [ ] **Per-expert written sign-off** on voice profile + first-person-vs-third-person rendition policy (their reputation rides on every answer).
- [ ] **Data-retention + deletion policy reviewed and published** — uploads by mode (temporary vs persistent), consultation transcripts, concierge review records, conversation history.
- [ ] **High-stakes-topic disclaimers + consultation-routing reviewed** (financial/legal/medical-adjacent advice liability).
- [ ] **Plan pricing & fair-use limits finalized with PM** and stated in plain language at point of purchase (free-tier question allowance, premium fair-use thresholds).
- [ ] **Payment/billing terms** (refunds, cancellation, proration) approved and reflected in the Stripe configuration + UI copy.

---

## Verification (end-to-end)

1. **Local dev:** `pnpm dev` runs web + admin + api against Dockerized Postgres+pgvector; seed script loads 2 sample experts, ~50 voice examples each, and sample published knowledge.
2. **Automated (run locally in Phase 1; wired into CI in Phase 2):** `pnpm test` (unit — **95%+ gate on critical modules, ~75% global**, enforced per-path in Jest config) + `pnpm test:integration` (Testcontainers) + `pnpm test:e2e` (Playwright path matrix) all green before each manual deploy.
3. **RAG eval:** run the golden-set harness — assert every citation resolves to a real chunk, low-confidence path fires on weak retrieval, voice-on≈voice-off accuracy per expert.
4. **Live dogfood:** use gstack `/qa` + `/browse` to walk the full user path (signup → ask → cited streamed answer → upload spreadsheet → numeric grounded answer → quota wall → upgrade → consultation booking) and the admin path (upload → publish → appears; unpublish → disappears).
5. **Security:** run `/cso` audit + authz/RLS negative tests + `/review` on the diff before landing.
6. **Design conformance:** run `/design-review` on the live UI against `requirements/Design System.md`; confirm the token lint is green (no hardcoded colors / off-scale px), citation markers render only after resolution, and the upload (info-blue) vs published (crimson) distinction holds.
7. **Deploy:** Terraform apply to a staging GCP project; manual `gcloud run deploy`; smoke test on Cloud Run (scale-to-zero verified); then promote.
