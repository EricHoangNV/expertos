# ExpertOS — Product Requirements & Implementation Plan (PRD)

> **ExpertOS** — *AI-Powered. OPEX-Driven.*

## Phased Delivery Roadmap

> **Design & implementation plan.** Live task status → `PRD-TRACKING.md`; completed-task build notes → `BUILD-NOTES.md`.
> Pick a task in `PRD-TRACKING.md`, then read its milestone section below for the design + implementation directions.
> Open items below carry their how-to inline. This doc changes only when features are (re)planned — never on a task run.

### Phase 0 — Foundation (§"Phase 0 — Foundation")

### Phase 1 — MVP (§"Phased Delivery Roadmap")

#### M1 — Expert knowledge ingestion + retrieval

#### M2 — Expert voice layer

#### M3 — Chat experience — COMPLETE

#### M4 — Citations — COMPLETE

#### M5 — Document uploads — COMPLETE

#### M6 — Subscription system — COMPLETE

#### M7 — Consultation funnel — COMPLETE

#### M8 — Admin & Expert portals

#### M9 — Concierge Mode (human-in-the-loop) — OD#5 RESOLVED

#### M10 — Analytics

#### M11 — Hardening
- **M11.4** Non-Technical Requirements sign-offs cleared (see manifest section below) — blocking before launch

### Open Decisions (§"Open Decisions") — resolve before the milestone each blocks
- OD#1 — Validation success criteria & kill line — ✅ RESOLVED: log all metrics now, review thresholds post-launch with real data (1 confirmed expert voice at launch; users pre-validated willingness to pay)
- OD#2 — Voice-fidelity acceptance bar — ✅ RESOLVED: expert reviews sample answers in portal, confirms via backend sign-off (no numeric rubric; satisfies NT.2)
- OD#3 — Voice profile cold-start workflow — ✅ RESOLVED: bulk upload (article/video/txt) → ingest → expert review → approve flow
- OD#4 — Unit economics: cost per answer vs price — blocks M6 seed matrix (PM + Eng, Phase 0) — RESOLVED in M6.5 (per-token cost model in `observability/model-pricing.ts` → real `cost_micros` on every usage row; calibrated seed quota matrix: Free 10/mo, Plus 200/mo hard cap, Premium softLimit 500/mo→degrade so worst-case ≈ break-even; see §"Open Decisions" #4)
- OD#5 — Concierge Mode B legal/brand ruling — ✅ RESOLVED: Mode B approved as default (ToS covers AI-reviewed content); visual indicator required on AI-reviewed/edited answers
- OD#6 — Eval golden-set ownership, size, refresh — DEFERRED (not blocking launch; revisit post-launch when scaling to multiple experts)
- OD#7 — Streaming vs citation-resolvability UX — blocks M3 / M4 (Eng + Design, early M3) — RESOLVED in M4.3 (stream prose, defer markers; render-after-resolve, server-side resolvability, click-to-passage; see §"Open Decisions" #7)
- OD#8 — Conversation context-window / cost ceiling policy — blocks M3 (Eng, early M3) — RESOLVED in M3.5 (token-budget window, deterministic/offline; LLM summarization deferred; see §"Open Decisions" #8)
- OD#9 — Vietnamese retrieval quality — blocks M1 (Eng, M1) — RESOLVED in M1.3 (cross-lingual default + mandatory NFC normalization; see §"Open Decisions" #9)
- OD#10 — TidyCal webhook reliability / missed-event recovery — blocks M7 (Eng, M7) — RESOLVED in M7.3 (raw-body HMAC verify → idempotent `booking_webhook_events` ledger keyed `[provider, eventId]`; correlate by `bookingRef` then booking email → user's pending `recommended` consultation; admin `reconcile` poll for missed-event recovery; unmatched bookings kept `matched=false` so nothing vanishes; see §"Open Decisions" #10)

### Non-Technical Requirements (§"Non-Technical Requirements") — pre-launch sign-offs, blocking
- NT.1 — Legal/brand sign-off on Concierge Mode B disclosure — ✅ RESOLVED (OD#5): Mode B approved as default with visual indicator
- NT.2 — Per-expert written sign-off — ✅ RESOLVED (OD#2): backend approval record as sign-off
- NT.3 — Data-retention + deletion policy reviewed and published — **TECHNICAL ENFORCEMENT DONE** (the published policy's auto-delete promise is now enforced by `apps/api/src/admin/retention.service.ts` `RetentionService` — the "sweeper" the M5.2 upload pipeline references: admin cross-tenant RLS `deleteMany` over the three side-effect-free classes [`temporary` uploads past stamped `expiresAt` → chunks cascade; conversations idle past the window by `updatedAt` → messages/citations/feedback/saved cascade; usage logs past the window by `occurredAt`], one audited entry in-tx, env-tunable windows defaulting to the policy values; `GET /admin/retention/preview` dry-run + `POST /admin/retention/sweep` admin routes, Cloud-Scheduler-triggerable per §"No full infra Day 1"; `apps/admin/app/retention` page; **now also enforces the two value-bearing classes** — consultation transcripts (`consultation_notes`) deleted past 1yr from the consultation date while the `consultations` revenue row is kept, and concierge review records (`review_responses`) **anonymized** in place past 1yr [answer text + reviewer notes scrubbed, structural row kept for M10.3 analytics; idempotent via a `[redacted]` sentinel; env-tunable `RETENTION_CONSULTATION_TRANSCRIPT_DAYS`/`RETENTION_CONCIERGE_DAYS`]). **Remaining: PM approval of the policy DRAFT + publishing it** (the human gate — not code)
- NT.4 — High-stakes-topic disclaimers + consultation-routing — **TECHNICAL ENFORCEMENT DONE** (deterministic high-stakes detector `packages/ai/src/high-stakes/` [financial/legal/medical/tax, EN+VI, whole-word over the shared tokenizer] wired at the `ChatService` seam → educational-scope system-prompt rule + `HIGH_STAKES_DISCLAIMER` surfaced on the live turn AND history read path + `high_stakes` flag on `messages`/`usage_logs` [migration `20260601090000`] + the M7 `topic` trigger now fires on the detector so the consultation CTA always accompanies the disclaimer). **Remaining: PM/legal sign-off on the disclaimer copy + ToS coverage** (the human review gate — not code)
- NT.5 — Plan pricing & fair-use limits finalized with PM, stated in plain language at purchase — DEFERRED (post-launch)
- NT.6 — Payment/billing terms (refunds, cancellation, proration) approved + reflected in Stripe config + UI copy — DEFERRED (post-launch)

#### M13 — UI Internationalization (i18n) — EN + VI
> The language toggle (M12.3.3) currently only switches the AI response language. This milestone makes the entire UI bilingual — all user-facing labels, placeholders, buttons, and messages switch when the user toggles EN/VI.

#### M12 — Frontend UI Overhaul — COMPLETE (§"UI Reference Spec" in `requirements/ui-reference-spec.md`)

> All backend APIs exist (M1–M11 complete). This milestone rebuilds the web frontend to match the approved UI mockup. Each task is independently shippable. Reference: `requirements/ui-reference-spec.md`.

##### M12.1 — Chat layout shell (three-pane grid)

##### M12.2 — Sidebar (conversation list + navigation)

##### M12.3 — Conversation header (topbar)

##### M12.4 — Chat messages area

##### M12.5 — Sources rail (right panel)

##### M12.6 — Input bar (bottom, sticky)

##### M12.7 — Tweaks panel (layout preferences)

##### M12.8 — Login page (already built)

##### M12.9 — Polish & responsive — COMPLETE

#### M13 — Admin & Expert Portal UI Overhaul (§"Admin & Expert Portal UI Reference Spec" in `requirements/ui-reference-spec.md`)

> All admin/expert APIs exist (M8, M9, M10 complete). This milestone rebuilds the admin portal to match the approved UI mockups. The existing `AdminFrame` + `.shell` layout is the foundation. Each task is independently shippable. Reference: `requirements/ui-reference-spec.md` (Admin section).

##### M13.1 — Sidebar & navigation overhaul

##### M13.2 — Dashboard (admin home)

##### M13.3 — Knowledge approval (kanban board)

##### M13.4 — Plans & Entitlements matrix — COMPLETE

##### M13.5 — Voice profile page (Expert Portal)
> **Honest scope note (this agent):** M13.5 is built as a **schema-honest lean version** — only fields the data model actually backs are rendered, no fabricated voice data. The mockup's *structured* widgets (Directness/Detail/Warmth dimension bars, Structure/Terminology chips, rendition policy, Do/Don't rules, neutral-vs-voiced comparison, per-example fidelity scores) have **no schema backing** — `VoiceProfile` carries only a free-text `guidelines` blob, and `VoiceExample` carries only `prompt`/`content`. Those sub-tasks (.3/.4/.5 + the fidelity/per-row-approve parts of .6) remain **DEFERRED pending a PM/schema decision** (same gate as M13.7.4 `.voice-bar`), because inventing those fields would bake an unreviewed voice-characterization model into the prompt builder that experts legally sign off on. New API: `GET /voice-profiles/:id` (`VoiceProfileService.get`, ownership/RLS-scoped) → profile + real examples.
- **M13.5.3** Voice Profile card (left): dimension bars (`.voice-bar` -- segmented crimson bar on gray track for Directness/Level of detail/Warmth with value labels), Structure `.chip` list, Terminology `.chip` list (mono), Rendition policy `.seg` (First person / Third person) — **DEFERRED: no schema backing** (only free-text `guidelines` exists; rendered as a guidelines card instead).
- **M13.5.4** Do & Don't Rules card (right): green checkmark + "do" rules, red X + "don't" rules — **DEFERRED: no schema backing** (do/don't rules are not modeled — folded into the free-text guidelines).
- **M13.5.5** Voice comparison card (right): "SAME FACTS . VOICE OFF VS ON" header + "FACTS IDENTICAL" `.badge-green`; two `.panel` blocks showing neutral vs voiced answer with visual distinction (muted border vs crimson accent) — **DEFERRED: no stored neutral-vs-voiced answer pair to render** (would require fabricated data).
- **M13.5.6** Voice Examples table (full width): TOPIC, SOURCE, FIDELITY, Action; example count header; wire to existing `/voice-profiles` API — **PARTIAL (schema-honest).** Real examples (`prompt` + `content`) are listed in `.panel` cards under an example-count header, wired to the new `GET /voice-profiles/:id`. *Omitted: FIDELITY scores (not measured/stored) + per-example Approve (sign-off is profile-level, not per-example).*

##### M13.6 — Concierge review queue (Expert Portal)

##### M13.7 — Admin polish & shared patterns
- **M13.7.4** Voice dimension bar component (`.voice-bar`): segmented bar with N filled crimson segments on gray track — **BLOCKED on M13.5** (voice profile page deferred pending a PM/schema decision — the mockup's voice dimensions have no schema backing; `.voice-bar` lands with that page).

#### M14 — Access Control Whitelist (§PRD-access-control.md)

> Invite-only admin portal gate. Only pre-authorized emails can sign in; role synced from whitelist on each login. Consumer app unaffected. Full spec: `requirements/PRD-access-control.md`.

##### M14.1 — Schema + shared types

##### M14.2 — API: admin session + CRUD

##### M14.3 — Seed + frontend client

##### M14.4 — Auth gate + UI

#### M15 — Test Coverage: Web & Admin Jest Suites + E2E Expansion

> **No new features.** This milestone closes the test-coverage gap flagged by every prior agent: `apps/web` and `apps/admin` have jest configs but **zero test files**, and the E2E suite has only 7 specs (18 tests, 3 fixme). The goal is launch-grade confidence in the two frontend apps and broader E2E coverage of the admin portal + i18n + access control flows.

##### M15.1 — Web app jest suite (`apps/web`)

##### M15.2 — Admin app jest suite (`apps/admin`)

##### M15.3 — E2E suite expansion (`e2e/`)

> **M15.3 enabling work (this agent) — the existing E2E suite was bit-rotted and unrunnable; repaired it to green against the live stack before adding the new specs:** the M12/M13/M14 overhauls broke the M11.1 fixtures — `signIn` waited on a removed "signed in as" badge (the login now redirects to `/chat`, M12.8.2); `signInAdmin` waited on a renamed "Expert" nav group (now "Expert portal", M13.1) and was blocked outright by the M14 whitelist; `web-upload` drove the upload controls inline (they moved into a popover, M12.6.2); `web-voice` used a removed `<select>` voice picker (now `.chip` pills, M12.3.2) and asserted "AI rendition of" as visible text (it's the badge aria-label); `admin-portal` asserted a removed knowledge review-queue dropdown (now the M13.3 kanban). Fixtures + 2 specs rewritten against the real DOM. Two real E2E-stack gaps found + fixed: the M14 whitelist seed (above) and the M11.2 per-IP rate limiter 429-ing the single-loopback-IP burst (`GET /conversations` failing as "couldn't load") — relaxed via `RATE_LIMIT_MAX` baked into the managed `webServer`. **Result: 20 passed / 3 fixme-skipped** (was 16 failed before the repair). Remaining open: M15.3.3 (concierge — needs a seeded review item), M15.3.4 (knowledge approve — needs a seeded Expert-Review doc), M15.3.5 (the 3 fixme legs: Stripe checkout = external surface; publish→retrieval + deletion cascade = seed prerequisites; all documented in-spec).

#### M16 — Per-expert calendar integration (TidyCal credentials per expert) — DONE (host E2E pending)

> Today TidyCal is a **single global** integration: one `TIDYCAL_API_TOKEN` (+ a now-vestigial `TIDYCAL_WEBHOOK_SECRET`) env pair (`apps/api/src/consultation/tidycal.defaults.ts`) and one process-singleton provider behind the `TIDYCAL_PROVIDER` DI token. But **each expert owns their own TidyCal account/calendar**, so credentials must be **per-expert**, configured by the expert in their portal. The current single-calendar config becomes the **default for Ngô Công Trường** (the primary expert) during migration so nothing breaks. Builds on M7 (consultation funnel, COMPLETE) and OD#10 (the idempotent `booking_webhook_events` ledger).
>
> **⚠️ Reality correction (this is why M16 was redesigned):** TidyCal has **no native webhooks** — confirmed against TidyCal's own FAQ (help.tidycal.com/article/739-faq: *"TidyCal does not currently offer native webhook support"*). TidyCal will never POST to us on a booking. The only first-party mechanism is the **REST API** (`GET /bookings`, Bearer token from TidyCal *Integrations → Automations*). Therefore the entire inbound-webhook design (per-expert webhook URL, `tidycal_webhook_token`, `TIDYCAL_WEBHOOK_SECRET`, HMAC verification) is **dropped** — it only ever made sense with a third-party relay (Zapier/Make/Pabbly), which the product owner has explicitly ruled out ("TidyCal API only"). Production booking sync is **per-expert polling** of `GET /bookings`, reusing the booking engine that already exists (`BookingService.reconcile` → `provider.listBookings` → `applyBookingEvent`, idempotent via the ledger with synthetic `reconcile:<ref>:<type>` event ids).
>
> **Design decisions (baked in — do not re-litigate):**
> - **Polling, not webhooks.** No inbound webhook from TidyCal in production; no webhook secret, no HMAC, no per-expert webhook URL/token, no `:token` route. The existing **offline JSON-envelope webhook route** (`POST /consultation-bookings/webhook`, `OfflineTidyCalProvider`) stays **only** as a local/dev/test driving seam (how the offline E2E simulates a booking lifecycle) and is never on the production TidyCal path. Production sync = the scheduled per-expert poll below.
> - **Per-expert credential = API token only, encrypted at rest.** Each `Expert` stores `tidycalApiTokenEnc` (nullable). No encryption helper exists today (verified: zero `cipher`/`encrypt`/`KMS` matches in-repo). Add an AES-256-GCM helper (`node:crypto` `createCipheriv`) keyed by a new env `CREDENTIALS_ENCRYPTION_KEY` (32-byte base64); store `iv:authTag:ciphertext`. Decrypt only inside the API when building a provider. **Never** return plaintext over any API or write it to logs — responses expose `configured: boolean` (+ optional masked `last4`) only. Env-key now; Cloud KMS envelope encryption is a later swap behind the same helper seam. (No webhook-secret field at all.)
> - **Provider resolved per-expert, not a singleton.** Replace the `TIDYCAL_PROVIDER` singleton (`createDefaultTidyCalProvider`, whose gate currently keys on the wrong env var — `TIDYCAL_WEBHOOK_SECRET`) with a `TidyCalProviderFactory.forExpert(expertId)` that decrypts that expert's token → `HttpTidyCalProvider({ apiToken })`; falls back to the env-global token (the Ngô Công Trường default), then `OfflineTidyCalProvider`. `BookingService` consumes the factory.
> - **Attribute bookings to an expert + poll per-expert.** `Consultation` has no expert link today (only `userId` + `typeId`); the expert is inferred from `conversation.expertId`. Add `Consultation.expertId` (nullable, `onDelete: SetNull`), populated from the conversation's expert when the consultation is created (`RecommendationService.respond`). The poll runs **per-expert** with that expert's token; correlation (bookingRef / email → that expert's pending `recommended` consultation) is scoped to the expert; idempotency is the existing ledger. **Scheduling:** no scheduler is installed today (`@nestjs/schedule` absent; `reconcile` is admin-triggered only). Drive it with an **external scheduler (Cloud Scheduler) hitting an internal admin reconcile endpoint** — no new always-on in-process dep — with `@nestjs/schedule` `@Cron` as the documented alternative. Poll uses a per-expert lookback (default 24h, as `reconcile` does now) or a stored `tidycalPolledAt` watermark; the ledger makes overlap harmless. **Known limitation (accept):** the poll classifies a booking as created vs cancelled (via `cancelled_at`) but cannot distinguish a *reschedule* — a re-poll of a moved booking arrives as `created` and simply updates `scheduledAt`, which is correct enough; true reschedule events are not detectable without webhooks.

#### M17 — Runtime answer-tuning settings + real embedding provider — PLANNED

> Our RAG answers currently run on `gpt-4o-mini` with **no temperature set** (defaults to ~1.0 — too exploratory for grounded QA), retrieval uses the **dev hashing embedder** (`HashingEmbeddingProvider`, lexical-only / not semantic — `ingestion.defaults.ts:31`, shared by both ingestion and retrieval via `createDefaultEmbeddingProvider`), and there is **no relevance floor** so even weak chunks reach the model as authoritative sources. All three degrade grounding. M17 adds an admin **Settings** page to tune **LLM temperature**, swap the **default chat model** (`gpt-4o-mini` ↔ `gpt-4o`), and set a **retrieval score floor** — applied in **real-time** — and wires a **real OpenAI embedding provider** (`text-embedding-3-small`, 1536-dim → matches the existing `vector(1536)` column + HNSW index, already priced in `model-pricing.ts`). Builds on the M8.1 publish workflow (the 349 KBM notes published in this cycle) and the M1.2 hybrid retrieval path.
>
> **Design decisions (baked in — do not re-litigate):**
> - **Temperature / default model / score floor are real-time.** They are per-request values; a `SettingsService` reads a single global `AppSettings` row through a **30s in-process TTL cache** (no Redis), so Save takes effect on the next message with no restart and no per-message DB hit. `update()` busts the cache. Clones the `ReviewConfig` + `ConciergeConfigService` + `concierge-config.controller.ts` pattern exactly (global table, no RLS policy, guarded by `@Roles("admin")` + audited in-tx).
> - **Settings are global, not per-tenant.** One row, mirroring `ReviewConfig` — this product runs as a single global tenant.
> - **DB (the AppSettings decision):** one global row — `AppSettings(llmTemperature Float=0.2, defaultChatModel String="gpt-4o-mini", retrievalScoreFloor Float=0, +timestamps)`, mapped `app_settings`, **no RLS** (admin-guarded at the controller); `defaultChatModel` constrained to the allowlist `{gpt-4o-mini, gpt-4o}`.
> - **Model switch threads a per-request override**, not a provider rebuild. Add `LlmCallOptions { temperature?, model? }` to the `LlmProvider` interface (`packages/ai/src/providers.ts`); each driver (OpenAI/Anthropic/Gemini/Echo) sets `temperature` in the body when provided and uses `options.model ?? this.name`. The single call site is `chat.service.ts:160`; the usage-log `model` field records the **effective** model so cost tracking matches (`gpt-4o` already priced PREMIUM). Standard tier only — the degraded/fair-use mini tier is untouched. Model choice is an **allowlist** (`gpt-4o-mini` | `gpt-4o`) to guarantee a pricing-table entry.
> - **Score floor filters the fused RRF score.** Add `minScore?` to `RetrievalRequest`; filter after `fuseHybrid` in `pgvector.store.ts:49`; `RetrievalService` reads the setting. **Note (units):** `.score` is the RRF fused score (small magnitudes, ~0.016/rank), **not** a 0–1 cosine — default `0` = off, UI uses a fine step + helper text. A cosine-based redesign is a documented follow-up.
> - **Embedding provider is env + restart, NOT a live toggle.** Switching embedders makes existing vectors incompatible (cosine becomes meaningless), so it cannot be runtime-changed — the Settings UI shows it **read-only with a "restart required — set via `EMBEDDING_PROVIDER` env" label**. Cutover uses a **brief degraded-vector window**: ship code (default stays hashing) → set `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY`, restart → immediately run a re-embed CLI over all ~2,414 chunks (~1–2 min, ~$0.05). During that minute vector search is degraded but **keyword search keeps serving answers**. Single embedding column; zero-downtime dual-column migration explicitly declined.

#### M18 — Uploaded document management ("My Knowledge") — PLANNED

> M5 lets a user attach a document and choose **Persistent** (indexed into their private knowledge, retrievable by any future question) or **Temporary** (scoped to the conversation, auto-expired by the M11/NT.3 `RetentionService` sweeper). But the upload path is **write-only from the user's side**: there is **no `GET /uploads`, no `DELETE /uploads/:id`, and no page** to see, confirm, or remove what was saved. A user who "remembers" a file has no way to verify it landed, review what their private knowledge contains, or delete a file (a data-control gap that also touches the NT.3 deletion policy — today a user can only purge uploads via full-account deletion). M18 closes the loop with a **read+delete API** over the existing `uploaded_files` rows and a **"My Knowledge"** page in `apps/web`, plus a discoverable entry point from the chat sidebar. **No changes to the upload, parse, embed, retrieval, or scoping logic** — this is a management surface over data M5 already produces. The M12.6.2 Mode picker was concurrently changed from a collapsed `<Select>` to a visible two-option `.seg` toggle so Persistent is no longer hidden (the bug that surfaced this gap).
>
> **Design decisions (baked in — do not re-litigate):**
> - **Reuse `UploadedFileDto` — no new DTO.** The existing shape (`packages/shared/src/upload.ts`) already carries `id, filename, contentType, sizeBytes, mode, chunkCount, scanned, scanClean, conversationId, expiresAt, createdAt` — everything the list/manage view needs. Add only a tiny `uploadListQuerySchema` (`scope: "persistent" | "temporary" | "all" = "all"`).
> - **List + delete are RLS-scoped, NOT entitlement-gated.** `GET /uploads` and `DELETE /uploads/:id` carry `@Roles("user")` only — **no `@RequiresEntitlement("document_upload")`**. A user who downgrades (or hits quota) must still **see and delete** documents they already saved; gating read/delete behind the upload entitlement would trap their data. Only the M5 `POST /uploads` (the expensive write path) keeps the entitlement guard. Tenant/user isolation is enforced by Postgres RLS inside the service (`this.rls.run(user, …)`), exactly as the M5 write path — a peer's uploads are invisible, and a cross-user delete resolves to a 404.
> - **Delete cascades chunks at the DB, best-effort deletes the blob.** `remove(user, id)` deletes the `uploaded_files` row inside `rls.run`; `upload_chunks` cascade via the existing `ON DELETE CASCADE` (the same cascade the `RetentionService` sweeper relies on). The GCS object is then removed best-effort via the existing `deleteStorageObjects(this.storage, [gcsUri], logger, …)` helper (`uploads/storage-cleanup.ts`) — a storage failure is logged, not surfaced as a request error (the row is already gone; an orphaned blob is harmless and the sweeper's own best-effort cleanup is the precedent).
> - **Deleting a cited file does not rewrite history.** A past saved answer keeps its citation snapshot text (M4 resolvability is a point-in-time guarantee); deletion only removes the file from **future** retrieval. The confirm copy says so. No attempt to find/scrub historical citations.
> - **One page, two sections, no admin surface.** `apps/web/app/knowledge/page.tsx` ("My Knowledge" / VI "Kho kiến thức của tôi"): a **Saved (persistent)** section and a **Temporary (expiring)** section (or a scope filter), each row showing filename, mode `Badge` (green/info, reusing M12.5 tones), size, searchable-chunks badge (`{count} searchable chunks` / `stored — not searchable yet`, strings already exist), created date, and for temporary rows a relative **"expires in N days"** from `expiresAt`. Per-row **Delete** with a confirm step. Empty state points back to chat ("Attach a document and choose Persistent to save it here"). This is a **consumer** surface (`apps/web`), not the admin portal — it shows only the signed-in user's own uploads.
> - **Discoverable from the chat sidebar.** Add a nav entry point (link to `/knowledge`) in the `apps/web` chat sidebar so "where did my remembered file go?" has an answer — the actual UX fix. New `knowledge` i18n namespace in `dictionaries.ts` (EN+VI), lockstep per M13.
> - **Pagination kept trivial.** List returns the user's uploads newest-first, capped (~100); cursor paging is a documented follow-up only if a real user exceeds it. No infinite scroll Day 1.

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
- **AI orchestration:** **Thin custom layer over provider SDKs** (OpenAI / Anthropic / Google) + pgvector, behind a small provider-abstraction interface. Full control over prompts, citation-to-chunk fidelity, grounding, and cost — citation integrity is the make-or-break feature in this category. **Provider config is per-capability and per-plan** (see §"AI Provider Configuration").
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
- **Local dev runs without Docker or Cloud Run** — `pnpm dev` + Cloud SQL Proxy against the GCP-hosted Postgres is the full dev stack. No container builds needed during development.
- **Cloud Run scale-to-zero** for staging/production API, admin, and ingestion jobs — pay only on traffic.
- **pgvector inside the existing Postgres** for MVP (no separate vector DB); the retrieval layer is abstracted beh

