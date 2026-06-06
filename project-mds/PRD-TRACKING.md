# ExpertOS — Task Tracking Manifest

> **How to use (agents):** Scan this manifest, pick the next open task (`[ ]` or `[~]`).
> Read **only** the design section it points to in `PRD.md` (§tag) — do **not** read the full PRD.
> When a task is done: flip its status **here**, and append the build note to `BUILD-NOTES.md`.
> **Never edit `PRD.md`** from a task run — it is the stable design/plan doc; it changes only when new features are planned.
>
> Status: `[x]` done · `[ ]` open · `[~]` partial/blocked. Completed-task build notes live in `BUILD-NOTES.md`.


### Task Manifest

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
- [x] M8.1 Admin: upload + versioned publish with expert-review gate (`Draft → AI Processing → Expert Review → Published`) — status as semantic `.badge` tones (§"Design System"); `.shell` shared with expert portal
- [x] M8.2 Admin: conversation-to-knowledge pipeline (Mark Valuable → Draft → Expert Review → Publish)
- [x] M8.3 Admin: plan-entitlement matrix editor + basic revenue reports (MRR, by plan/period) + failed/low-confidence query inspector
- [x] M8.4 Admin: manage users / subscriptions / experts / voice profiles; admin audit logs; user-data deletion
- [x] M8.5 Expert portal (first-class `expert` role): approve voice + knowledge, review AI answers, view consultation conversions

#### M9 — Concierge Mode (human-in-the-loop) — OD#5 RESOLVED
- [x] M9.0 **GATE:** Open Decision #5 (Mode B legal/brand ruling) resolved
- [x] M9.1 Admin trigger config (off / user-prompted / auto-silent) + confidence threshold + SLA + volume cap
- [x] M9.2 Concierge review queue in Expert portal; reviewer verdict (Good/Bad/Great) + edit
- [x] M9.3 Async delivery (visible update vs silent) + transactional email notification
- [x] M9.4 Reviewer-feedback flywheel: conversation-context injection (immediate) + `voice_examples`/`knowledge_drafts`/chunk-flagging (global); escalate-to-consultation

#### M10 — Analytics
- [x] M10.1 Usage & cost analytics
- [x] M10.2 Consultation funnel + attribution (question→conversation→recommendation→booking→revenue)
- [x] M10.3 Concierge volume/SLA/verdict metrics + knowledge-quality signals
- [x] M10.4 Instrument all validation metrics (activation, engagement, willingness-to-pay, funnel conversion, revenue/user) — thresholds set post-launch with real data (OD#1 resolved)

#### M11 — Hardening
- [x] M11.1 Full E2E path matrix (Playwright) — see §"Testing Strategy"
- [x] M11.2 Security tests (authz/RLS negative, prompt-injection regression, rate-limit) + `/cso` audit
- [x] M11.3 Performance / caching tuning + load smoke test
- [ ] M11.4 Non-Technical Requirements sign-offs cleared (see manifest section below) — blocking before launch
- [x] M11.5 Design-system conformance audit (`/design-review`): token usage (no hardcoded colors/px), citation render-after-resolve, upload-vs-knowledge color distinction, badge tones, hit-target/size minimums (§"Design System")

### Open Decisions (§"Open Decisions") — resolve before the milestone each blocks
- [x] OD#1 Validation success criteria & kill line
- [x] OD#2 Voice-fidelity acceptance bar
- [x] OD#3 Voice profile cold-start workflow
- [x] OD#4 Unit economics: cost per answer vs price — blocks M6 seed matrix (PM + Eng, Phase 0)
- [x] OD#5 Concierge Mode B legal/brand ruling
- [ ] OD#6 Eval golden-set ownership, size, refresh
- [x] OD#7 Streaming vs citation-resolvability UX — blocks M3 / M4 (Eng + Design, early M3)
- [x] OD#8 Conversation context-window / cost ceiling policy — blocks M3 (Eng, early M3)
- [x] OD#9 Vietnamese retrieval quality — blocks M1 (Eng, M1)
- [x] OD#10 TidyCal webhook reliability / missed-event recovery — blocks M7 (Eng, M7)

### Non-Technical Requirements (§"Non-Technical Requirements") — pre-launch sign-offs, blocking
- [x] NT.1 Legal/brand sign-off on Concierge Mode B disclosure
- [x] NT.2 Per-expert written sign-off
- [~] NT.3 Data-retention + deletion policy reviewed and published
- [~] NT.4 High-stakes-topic disclaimers + consultation-routing
- [ ] NT.5 Plan pricing & fair-use limits finalized with PM, stated in plain language at purchase
- [ ] NT.6 Payment/billing terms (refunds, cancellation, proration) approved + reflected in Stripe config + UI copy

#### M13 — UI Internationalization (i18n) — EN + VI
- [x] M13.1 i18n framework: add `next-intl` or a lightweight `t()` helper with EN/VI JSON dictionaries; wire the language toggle (M12.3.3) to switch the active locale and persist in localStorage + user profile
- [x] M13.2 Translate web app: all static UI strings in `/chat`, `/history`, `/account` pages — sidebar labels, buttons, placeholders, empty states, error messages, tooltips, usage meter, plan names
- [x] M13.3 Translate admin portal: all static UI strings in admin pages — navigation, table headers, form labels, status badges, action buttons
- [x] M13.4 Translate system-generated content: high-stakes disclaimer (NT.4), concierge disclosure tooltip (OD#5), insufficient-knowledge message, consultation CTA copy
- [x] M13.5 RTL-safe + locale-aware formatting: dates, numbers, currency display respect the active locale (Vietnamese date format, VND currency where applicable)

#### M12 — Frontend UI Overhaul — COMPLETE (§"UI Reference Spec" in `requirements/ui-reference-spec.md`)

##### M12.1 — Chat layout shell (three-pane grid)
- [x] M12.1.1 Create `.chat-layout` CSS: three-pane grid (sidebar 248px + chat flex:1 + sources-rail 320px) using ds.css tokens; responsive breakpoints (collapse sources-rail < 1280px, collapse sidebar < 900px)
- [x] M12.1.2 Extract `ChatLayout` component wrapping sidebar + main + rail; integrate into `/chat` route replacing the current single-card layout
- [x] M12.1.3 Layout direction switcher state (classic / studio / focus) — studio = default three-pane; classic = two-pane + sources drawer overlay; focus = no sidebar + sources drawer

##### M12.2 — Sidebar (conversation list + navigation)
- [x] M12.2.1 Sidebar component: ExpertOS `.logo` wordmark (white on dark), close/collapse button, "+ New conversation" `.btn-primary` full-width
- [x] M12.2.2 Conversation search input (`.input` on dark bg, "Search all messages..." placeholder); wired to existing full-text search API (M3.3)
- [x] M12.2.3 Conversation list: "RECENT" `.navgroup` label; conversation items with expert-colored avatar circle (initials), truncated title, relative time, unread dot; `.navitem.active` for current; sorted most-recent-first; wired to history API (M3.2)
- [x] M12.2.4 Usage meter at sidebar bottom: "questions this month" label, "N / M" count, `.bar` progress (crimson fill), plan badge (`.label`), "Upgrade" link (crimson); wired to `/me/entitlements` API (M6.1)

##### M12.3 — Conversation header (topbar)
- [x] M12.3.1 Topbar component: conversation title (auto-titled from M3.2), editable on click
- [x] M12.3.2 Voice picker: "VOICE" `.label` + `.chip` / `.chip.active` pills for each expert voice; wired to existing experts API; selecting a chip switches the active expert for the conversation
- [x] M12.3.3 User identity display: avatar + name + language badge (EN/VI) right-aligned

##### M12.4 — Chat messages area
- [x] M12.4.1 User message bubble: `.msg-user` — dark bg (`--ink-900`), white text, `--r-lg`, max-width ~70%, right-aligned or left-aligned per layout direction
- [x] M12.4.2 Assistant message: `.msg-assistant` — expert avatar (colored circle + initials), expert name (bold), "AI RENDITION" `.badge-ink`, "grounded in published knowledge + your upload" source label (`.muted` mono), optional "VERIFIED" `.badge-green`
- [x] M12.4.3 Answer prose with inline citations: existing `AnswerView` component (M4.2) with `.cite` crimson markers + `.cite.upload` blue markers; render-after-resolve behavior preserved
- [x] M12.4.4 Action bar below each completed answer: "View sources (N)" toggle (`.btn-ghost`), "Save" (`.btn-ghost`), thumbs up/down feedback — refactor existing `AnswerFeedback` + `SaveAnswer` into a horizontal bar layout
- [x] M12.4.5 Consultation recommendation card: warm background card with icon + heading + description + "Book with [Expert]" (`.btn-primary`) + "Maybe later" / "Ask another question" (`.btn-ghost`) — restyle existing `ConsultationPrompt`
- [x] M12.4.6 Insufficient-knowledge, high-stakes, and degraded states: restyle existing cards to match the design system badge/card patterns

##### M12.5 — Sources rail (right panel)
- [x] M12.5.1 `.sources-rail` container: 320px sticky right panel, `--line` left border, scrollable; shows sources for the currently selected/latest answer
- [x] M12.5.2 Rail header: "SOURCES" `.label` + passage count + `.trust-badge` ("ALL CITATIONS RESOLVED TO A REAL CHUNK" outlined crimson pill with checkmark)
- [x] M12.5.3 Source cards: numbered, match percentage (mono, right-aligned), document icon (crimson for knowledge / blue for upload), title + version badge, location provenance (`.source-prov` mono), excerpt with left crimson/blue border (`.source-quote`); wired to existing citation data from `AnswerView`
- [x] M12.5.4 Sources drawer fallback: when sources-rail is hidden (classic/focus mode or narrow viewport), sources open as a slide-over drawer instead

##### M12.6 — Input bar (bottom, sticky)
- [x] M12.6.1 `.input-bar` sticky bottom container: attach document button (`.btn-subtle` icon left), text input ("Ask [Expert] anything about your business..." placeholder), send button (crimson circle with arrow icon, right)
- [x] M12.6.2 Upload attachment flow: clicking attach opens existing `UploadPanel` as a popover/dropdown above the input bar; show file type chips (XLSX, CSV, PDF, DOCX) + "TEMPORARY / NOT INDEXED" label after upload
- [x] M12.6.3 Helper text below input: "Enter to send / Shift + Enter newline" (left), "N questions left this month" (right, from entitlements API)
- [x] M12.6.4 Keyboard behavior: Enter sends (unless Shift held); auto-resize textarea

##### M12.7 — Tweaks panel (layout preferences)
- [x] M12.7.1 Tweaks floating panel: "Tweaks" header + close X, bottom-right overlay, card with shadow
- [x] M12.7.2 Chat layout direction: `.seg` segmented control (classic / studio / focus) with one-line descriptions; persisted to localStorage
- [x] M12.7.3 Density options: `.seg` segmented control (compact / regular / comfy); toggle switches for "Verified trust badge" + "Concierge review offer"
- [x] M12.7.4 "Hide tweaks" / "Show tweaks" button in the topbar toolbar

##### M12.8 — Login page (already built)
- [x] M12.8.1 Two-panel login: left panel (logo + headline + Google sign-in + legal text), right panel (dark bg with "DRIVEN BY EXCELLENCE" eyebrow); responsive collapse
- [x] M12.8.2 Post-login redirect: after Google sign-in, redirect to `/chat` (existing); handle returning users (skip login if session active)

##### M12.9 — Polish & responsive — COMPLETE
- [x] M12.9.1 Mobile responsive: sidebar as slide-over overlay (< 900px), sources rail hidden, input bar full-width
- [x] M12.9.2 ds.css conformance: no hardcoded colors/px; all new components use ds.css tokens; upload = info-blue, knowledge = crimson distinction maintained
- [x] M12.9.3 Dark sidebar: ensure all sidebar elements (logo, nav items, search, usage) render correctly on `--ink-900` background
- [x] M12.9.4 Loading/empty states: skeleton loaders for conversation list, "Start a new conversation" empty state for chat area, spinner for streaming

#### M13 — Admin & Expert Portal UI Overhaul (§"Admin & Expert Portal UI Reference Spec" in `requirements/ui-reference-spec.md`)

##### M13.1 — Sidebar & navigation overhaul
- [x] M13.1.1 Restructure sidebar nav groups to match mockup: OPERATE (Dashboard, Knowledge + count badge, Conversation -> Knowledge, Low-confidence queries + count badge), MONETIZE (Plans & Entitlements, Revenue, Users & Subscriptions), EXPERT PORTAL (Voice profiles, Concierge queue + count badge)
- [x] M13.1.2 Count badges on nav items: fetch counts from existing APIs (knowledge needing review, flagged queries, open concierge items) and render as `.navitem .tag`
- [x] M13.1.3 Bottom-pinned user identity: avatar (initials + colored circle) + name + role label ("Admin . ExpertOS"); Sign out button (`.btn-ghost` on dark)
- [x] M13.1.4 Topbar: breadcrumb ("ADMIN > Page Name" `.label`), role badge ("ADMIN VIEW" `.badge-red` / "EXPERT VIEW" `.badge-amber`), notification bell icon, "All screens" link

##### M13.2 — Dashboard (admin home)
- [x] M13.2.1 Page header: greeting "Good morning, [Name]" (`.h1`), subtitle with validation loop text (`.lede`), time-range segmented control (7d / 30d / QTD `.seg`); wire to existing analytics APIs
- [x] M13.2.2 KPI stat cards: 4-up grid of `.stat` cards (MRR, Active Subscribers, Citation Resolve Rate, Consult Conversions) with `.v` display value + `.d` delta (`.up`/`.down`); wire to `/admin/analytics/usage` + `/admin/analytics/validation` + `/admin/revenue/report`
- [x] M13.2.3 Questions Answered card: large number + badge row (GROUNDED `.badge-green`, LOW-CONF `.badge-red`, INSUFFICIENT `.badge-ink` with percentages) + stacked bar chart (new `.progress-bar-stacked`)
- [x] M13.2.4 Consultation Funnel card: horizontal bar rows (Questions -> Recommend -> Booked -> Revenue) using `.bar` with proportional fills + bottom summary text; wire to `/admin/analytics/funnel`
- [x] M13.2.5 Low-Confidence Queries card: `.eyebrow` header + query list (confidence circle badge on red-amber scale, question text, metadata `.muted`, "Draft knowledge" `.btn-ghost`); wire to `/admin/failed-queries`
- [x] M13.2.6 Knowledge Pipeline card: status rows with badge tones (DRAFT `.badge-ink`, AI PROCESSING `.badge-info`, EXPERT REVIEW `.badge-amber`, PUBLISHED `.badge-green`) + counts; "Review queue ->" link; wire to `/knowledge` API
- [x] M13.2.7 Concierge SLA card: dark card variant (`.dark-card`, `--ink-900` bg, white text), "CONCIERGE SLA" label + queue count badge, large time display, "Open queue ->" button; wire to `/admin/analytics/concierge`

##### M13.3 — Knowledge approval (kanban board)
- [x] M13.3.1 Page header: eyebrow "VERSIONED . EXPERT-REVIEWED", heading "Knowledge approval", "+ New note" (`.btn-ghost`) + "Upload (MD / PDF / XLSX)" (`.btn-primary`) actions
- [x] M13.3.2 Status pipeline: horizontal numbered step indicator (1 Draft, 2 AI Processing, 3 Expert Review active crimson, 4 Published) with descriptive text below
- [x] M13.3.3 Kanban board: 4-column `.kanban` layout (DRAFT, AI PROCESSING, EXPERT REVIEW, PUBLISHED); each column is a `.kanban-col` (card-based, scrollable); wire to existing `/knowledge` list API with status filters
- [x] M13.3.4 Kanban cards per status: Draft (title + file-type badge + expert), AI Processing (title + file badge + progress description + crimson progress bar), Expert Review (title + version badge + change description + "Approve & publish" `.btn-primary` + "Diff" `.btn-ghost`, highlighted amber border on active card), Published (title + version "LIVE" `.badge-green` + approval info + citation count)
- [x] M13.3.5 Conversation-to-Knowledge section below kanban: `.eyebrow` header, heading, pipeline breadcrumb pills, `.table` with columns (RECURRING QUESTION, FREQUENCY badge, BEST EXISTING ANSWER, EXPERT, "Draft" `.btn-primary`); wire to `/knowledge-drafts` + `/admin/failed-queries`

##### M13.4 — Plans & Entitlements matrix — COMPLETE
- [x] M13.4.1 Page header: eyebrow "CONFIGURATION, NOT CODE", heading, subtitle explaining the matrix, "Reset to seed" (`.btn-ghost`) + "Publish changes" (`.btn-primary`)
- [x] M13.4.2 Matrix table (`.matrix-table`): column headers with plan name + real pricing (Free $0, Plus $4.99/mo, Premium $9.99/mo · $69.99/yr — surfaced via new `EntitlementPlanPriceDto`/`prices[]` on the matrix DTO + `PlanPrice` join in `EntitlementMatrixService.getMatrix`); top-tier column visually emphasized (`.matrix-col-premium` crimson-tinted bg + crimson bold header); row type badge (boolean=ink / metered=info). Honest deviation: the data model has only `boolean`/`metered` feature types — no `enum` type exists — so the spec's enum row is rendered per its real type.
- [x] M13.4.3 Cell rendering: boolean = `.switch` toggle (crimson when on; em-dash when off); metered = editable hard-limit `.input` + window `.select` (unit "/day"·"/week"·"/month") + soft-limit input, "UNLIMITED" `.label` when uncapped; dirty cells show an "Unsaved" `.badge-amber`, per-cell publish/validation errors inline.
- [x] M13.4.4 Footer info cards: 2-up grid below matrix (`.matrix-foot`), "FAIR USE" (`.badge-amber`) degrade-don't-block card + "QUOTA CELLS" (`.badge-info`) OD#4 card; wired to existing `/admin/entitlements` API.

##### M13.5 — Voice profile page (Expert Portal)
- [x] M13.5.1 Page header: expert avatar (large, colored) + name (`.h1`) + meta (example count `.muted`) + "AWAITING YOUR SIGN-OFF" `.badge-amber` + sign-off action `.btn-primary`
- [x] M13.5.2 Warning banner: full-width amber card with warning text about reputation/voice/facts separation
- [ ] M13.5.3 Voice Profile card (left): dimension bars (`.voice-bar` -- segmented crimson bar on gray track for Directness/Level of detail/Warmth with value labels), Structure `.chip` list, Terminology `.chip` list (mono), Rendition policy `.seg` (First person / Third person)
- [ ] M13.5.4 Do & Don't Rules card (right): green checkmark + "do" rules, red X + "don't" rules
- [ ] M13.5.5 Voice comparison card (right): "SAME FACTS . VOICE OFF VS ON" header + "FACTS IDENTICAL" `.badge-green`; two `.panel` blocks showing neutral vs voiced answer with visual distinction (muted border vs crimson accent)
- [~] M13.5.6 Voice Examples table (full width): TOPIC, SOURCE, FIDELITY, Action; example count header; wire to existing `/voice-profiles` API

##### M13.6 — Concierge review queue (Expert Portal)
- [x] M13.6.1 Two-pane layout: queue list (~380px left) + review detail (flex:1 right), inside the existing `.shell` content area
- [x] M13.6.2 Queue list: header "QUEUE . N OPEN" + "SLA 24H" `.badge-amber`, filter `.seg` (Open / Mine / Done), queue items (question text truncated, mode badge "AUTO . SILENT" `.badge-ink` or "USER-PROMPTED" `.badge-amber`, confidence badge `.badge-red`, time elapsed); active item highlighted; wire to `/concierge-reviews` list API
- [x] M13.6.3 Review detail header: mode indicator badge, confidence badge, SLA time badge (all with dots)
- [x] M13.6.4 User question section: `.label` with user email + voice name, dark card (`.dark-card` / `.msg-user` style) with question text, context line (`.muted`) explaining retrieval score + flag reason
- [x] M13.6.5 AI answer section: `.label` explaining "user saw this", `.panel` with "AI RENDITION" `.badge-ink` + "low confidence" + answer text
- [x] M13.6.6 Verdict section: "YOUR VERDICT" `.label`, three `.verdict-card` options (Bad: X + "flags source chunks", Good: checkmark + "deliver as-is", Great: star + "-> voice example"); selectable with hover/active state
- [x] M13.6.7 Refined answer section: `.label` + `.textarea` pre-filled with original, flywheel info text (`.muted`) explaining immediate + global effects
- [x] M13.6.8 Action bar: "Push refined update" (`.btn-primary` + icon), "Escalate to paid consultation" (`.btn-dark` + icon), "Dismiss" (`.btn-ghost`), "User notified by email on delivery" (`.muted`); wire to `/concierge-reviews/:id` respond/escalate APIs

##### M13.7 — Admin polish & shared patterns
- [x] M13.7.1 Role-aware sidebar: admin sees all groups; expert sees only EXPERT PORTAL group (existing `AdminFrame` role logic, restyle to match mockup grouping)
- [x] M13.7.2 Dark card component (`.dark-card`): reusable `--ink-900` bg, white text, `--r-lg` radius card for Concierge SLA, user question bubbles
- [x] M13.7.3 Kanban component: reusable `.kanban` + `.kanban-col` for any status-pipeline view
- [ ] M13.7.4 Voice dimension bar component (`.voice-bar`): segmented bar with N filled crimson segments on gray track
- [x] M13.7.5 ds.css conformance: no hardcoded colors/px; all badge tones match Design System rules (Draft=ink, Processing=info, Review=amber, Published=green)

#### M14 — Access Control Whitelist (§PRD-access-control.md)

##### M14.1 — Schema + shared types
- [x] M14.1.1 Prisma `AllowedEmail` model (`@@unique([tenantId, email])`, `@@map("allowed_emails")`) + reverse relations on `Tenant`/`User`; run `prisma migrate dev`
- [x] M14.1.2 `packages/shared/src/access-control.ts`: Zod schemas (`allowedEmailRoleSchema`, `allowedEmailCreateSchema`, `allowedEmailUpdateSchema`) + DTO types (`AllowedEmailDto`, `AdminSessionDto`); export from index

##### M14.2 — API: admin session + CRUD
- [x] M14.2.1 `AdminSessionService` + `POST /me/admin-session`: whitelist check → role sync → session DTO; 403 for non-whitelisted emails (no `@Roles` — any authenticated user can call)
- [x] M14.2.2 `AccessControlService` + `AccessControlController`: `GET/POST/PATCH/DELETE /admin/access-control` (`@Roles("admin")`); self-lockout protection (cannot remove/demote own email); audit logging (`access_control.email_added/role_changed/email_removed`); 409 on duplicate email
- [x] M14.2.3 Register `AdminSessionService` in `auth.module.ts`; register access-control controller + service in `admin.module.ts`

##### M14.3 — Seed + frontend client
- [x] M14.3.1 Seed `eric.nguyen.vn@gmail.com` as `role: admin` in `packages/db/prisma/seed.ts` (upsert — bootstraps first admin)
- [x] M14.3.2 Admin client functions: `adminSession`, `listAllowedEmails`, `addAllowedEmail`, `updateAllowedEmail`, `removeAllowedEmail`

##### M14.4 — Auth gate + UI
- [x] M14.4.1 Auth context: replace `getMe(token)` with `adminSession(token)`; add `denied: boolean` state (set on 403); expose on `AuthContextValue`
- [x] M14.4.2 `AdminFrame`: Access Denied screen when `denied === true` ("Your email is not authorized…" + Sign out button)
- [x] M14.4.3 Access Control page (`app/access-control/page.tsx`): add form (email + role select + Add), table (Email, Role badge, Added by, Added at, Actions), role toggle + Remove with confirmation; nav item under SYSTEM group (`role: "admin"`)

#### M15 — Test Coverage: Web & Admin Jest Suites + E2E Expansion

##### M15.1 — Web app jest suite (`apps/web`)
- [x] M15.1.1 Test harness setup: mock providers (Firebase auth, locale context, router), shared render helpers, MSW or manual fetch mocks for API calls (`/me`, `/conversations`, `/entitlements`, `/chat`)
- [x] M15.1.2 Chat page tests: message rendering (user bubble + assistant message + citations), send flow (input → API call → stream append), voice picker selection, layout direction switching, empty state, error states, insufficient-knowledge / high-stakes / degraded notice rendering
- [x] M15.1.3 History page tests: conversation list rendering + search, conversation detail (message replay + saved answers), rename, delete
- [x] M15.1.4 Account page tests: plan display + usage meter, locale toggle persistence, sign-out flow
- [x] M15.1.5 i18n tests: locale provider switching (EN→VI), dictionary key completeness (all `useT` calls resolve), formatted dates/currency respect active locale
- [x] M15.1.6 Shared hooks/lib tests: `useMediaQuery`, `useLocale`, `useT`, API client functions, `firebase.ts` emulator-aware init

##### M15.2 — Admin app jest suite (`apps/admin`)
- [x] M15.2.1 Test harness setup: mock auth context (admin vs expert role), locale context, admin-client fetch mocks, shared render helpers
- [x] M15.2.2 AdminFrame tests: role-aware nav filtering (admin sees all groups, expert sees only EXPERT PORTAL), breadcrumb rendering, nav count badges, sidebar footer identity, access-denied gate when `denied=true`
- [x] M15.2.3 Dashboard tests: KPI cards render with mock analytics data, funnel bar proportions, low-confidence query list, knowledge pipeline status badges, concierge SLA card
- [x] M15.2.4 Knowledge page tests: kanban board column rendering per status, card actions (approve/request-changes), conversation-to-knowledge table
- [x] M15.2.5 CRUD page tests: entitlement matrix cell editing + staged publish + discard, access control add/remove/role-toggle + self-lockout guard, user management role change + deletion request
- [x] M15.2.6 Concierge review queue tests: two-pane layout, queue list filtering (Open/Mine/Done), verdict selection, refined answer submit, escalate action
- [x] M15.2.7 i18n tests: admin locale provider, `useStatusLabel` hook with all 43 status tokens, dictionary lockstep verification (EN/VI key parity across all 24 namespaces)

##### M15.3 — E2E suite expansion (`e2e/`)
- [x] M15.3.1 Admin i18n E2E: toggle admin locale EN→VI, verify nav labels + page headers + status badges switch language
- [x] M15.3.2 Access control E2E: add email to whitelist, verify it appears in table, toggle role, remove email, verify access-denied screen for non-whitelisted user
- [x] M15.3.3 Concierge review E2E: open review queue, select item, submit verdict with edit, verify delivery
- [x] M15.3.4 Knowledge approval E2E: navigate kanban board, filter by status, approve a document from Expert Review → Published
- [x] M15.3.5 Resolve existing `test.fixme` legs: full publish→retrieval round-trip (seed prerequisite), deletion cascade, Stripe checkout page (external surface) — unblock or document why each remains skipped
- [x] M15.3.6 Web i18n E2E: toggle web locale EN→VI, verify chat UI labels + history page + account page switch language
- [x] M15.3.7 E2E negative-space expansion: regression-guard the recent Security/Product fixes and the untested failure/permission/isolation paths the happy-path suite missed

#### M16 — Per-expert calendar integration (TidyCal credentials per expert) — DONE (host E2E pending)
- [x] M16.1 **Schema + encryption helper.**
- [x] M16.2 **Per-expert provider factory + booking service.**
- [x] M16.3 **Per-expert poll.**
- [x] M16.4 **Expert self-service + admin settings API.**
- [x] M16.5 **Expert Portal UI (`apps/admin`).**
- [x] M16.6 **Default = Ngô Công Trường + back-compat.**
- [x] M16.7 **Security + tests.**

#### M17 — Runtime answer-tuning settings + real embedding provider — M17.1–M17.6 DONE; M17.7 prod cutover pending
- [x] M17.1 **Settings persistence** — add the `AppSettings` Prisma model + hand-written migration; `AppSettingsDto`/`AppSettingsUpdateInput` + zod validators in `packages/shared` (temp ∈ [0,2]; model ∈ {gpt-4o-mini, gpt-4o}; floor ∈ [0,1]).
- [x] M17.2 **SettingsService + controller** — clone `concierge-config.service.ts`: `get`/`update` (upsert + `AdminAuditService` in-tx) + `getCached()` 30s-TTL bust-on-update; `app-settings.controller.ts` `@Roles("admin")` `GET`/`PATCH /admin/app-settings`; `SettingsModule` imported by `ChatModule` + `RetrievalModule`.
- [x] M17.3 **Thread temperature + model through the LLM call** — add `LlmCallOptions {temperature?,model?}` (`providers.ts`); `StreamingLlmProvider.complete`→`completeStream` passes it (`http.ts`); OpenAI/Anthropic/Gemini/Echo honor temp + `options.model`; `chat.service.ts:160` reads `getCached()`, passes `{temperature,model}`, logs the effective model.
- [x] M17.4 **Retrieval score floor** — `minScore?` on `RetrievalRequest`; filter after `fuseHybrid` in `pgvector.store.ts`; `RetrievalService` sets it from settings; focused filter test.
- [x] M17.5 **Admin Settings page** — `app/settings/page.tsx` mirroring `concierge/page.tsx`: temp (0–2, step .05), model `<Select>`, floor (0–1, step .005 + RRF helper text), read-only Embeddings 'restart required' note; `getAppSettings`/`updateAppSettings` in `admin-client.ts`; nav item + `dictionaries/settings.ts` (EN+VI).
- [x] M17.6 **OpenAI embedding provider + re-embed CLI** — `packages/ai/src/embedding/openai-embedding-provider.ts` (1536-dim, batches ≤256, order-preserving, reuse `defaultFetch`/`LlmRequestError`); gate `createDefaultEmbeddingProvider()` on `EMBEDDING_PROVIDER=openai`; `apps/api/src/ingestion/reembed.cli.ts` (mirror `publish-drafts.cli.ts`, dry-run + `--commit`) UPDATEs every chunk's `embedding`; `"reembed"` npm script.
- [~] M17.7 **Cutover + verification** — ship → set env + restart → `reembed --commit`; verify temp=0 in the request within 30s, usage-log shows `gpt-4o`, floor drops low-score chunks, a paraphrased query retrieves the right note; gates: ai/api/admin/shared typecheck+lint+test. **Validated locally (2026-06-05):** `.env` flip `EMBEDDING_PROVIDER=openai` → dry-run reports `text-embedding-3-small (1536 dims)` → full `reembed --commit` over **2676 chunks, 0 failed** with the default `--batch=256`. **Bug found+fixed:** the default 256-batch overran Prisma's 5s interactive-tx timeout (`Transaction already closed`, partial write → mixed vector space); now an explicit 30s tx timeout on the write (`reembed.cli.ts`, commit `ae7e234`) — api 800 tests still green. **Local-DB drift caught:** the M17.1 `app_settings` migration was unapplied on the host → admin Settings page 500; fixed with `prisma migrate deploy` (deploy pipeline must run this). **Still pending (external):** prod deploy, prod env + restart, prod `reembed --commit`, and the four prod verifications.

#### M18 — Uploaded document management ("My Knowledge") — COMPLETE (§"M18 — Uploaded document management")

> Read+delete management surface over the M5 `uploaded_files` the user already produces — a `GET /uploads` + `DELETE /uploads/:id` API and an `apps/web` "My Knowledge" page, so a user can see/confirm/remove what they "remembered." No changes to upload/parse/embed/retrieval/scoping. Read only §"M18 — Uploaded document management" in `PRD.md` for the baked-in decisions before starting a leg.

##### M18.1 — Shared: list-query schema
- [x] M18.1.1 `packages/shared/src/upload.ts`: add `uploadListQuerySchema = z.object({ scope: z.enum(["persistent","temporary","all"]).default("all") })` + `UploadListQuery` type; export from index. **Reuse the existing `UploadedFileDto`** for list rows — do **not** add a new DTO.

##### M18.2 — API: list + delete (RLS-scoped, NOT entitlement-gated)
- [x] M18.2.1 `UploadService.list(user, scope)` in `apps/api/src/uploads/upload.service.ts`: `this.rls.run(user, tx => tx.uploadedFile.findMany(...))`, newest-first (`orderBy: { createdAt: "desc" }`), `take: 100`; `scope` filters on `mode` (`all` = no filter); map rows through the **existing `UploadedFileDto` mapper** (extract the inline post-upload mapper into a shared private helper so list + create never drift).
- [x] M18.2.2 `UploadService.remove(user, id)`: inside `this.rls.run`, `findUnique` the row (404 `NotFoundException` if missing/not-owned — RLS makes a peer's row invisible, so cross-user delete naturally 404s), capture its `gcsUri`, `tx.uploadedFile.delete({ where: { id } })` (chunks cascade via `ON DELETE CASCADE`); **after** the tx, best-effort `deleteStorageObjects(this.storage, [gcsUri], this.logger, { uploadedFileId: id })` (log-not-throw on blob failure). Mirror the `RetentionService` storage-cleanup pattern.
- [x] M18.2.3 `upload.controller.ts`: add `@Get()` `list(@CurrentUser() user, @Query(new ZodValidationPipe(uploadListQuerySchema)) q)` and `@Delete(":id")` `remove(@CurrentUser() user, @Param("id") id)` — **`@Roles("user")` only, NO `@RequiresEntitlement`** (a downgraded/over-quota user must still see + delete their own data; only `POST` keeps the `document_upload` guard).
- [x] M18.2.4 Tests (`upload.service.test.ts` + `upload.controller.test.ts`, coverage gate in the service): list returns only the caller's rows newest-first + `scope` filter; delete removes the row, cascades chunks, and calls `deleteStorageObjects`; a blob-delete failure still resolves the request; cross-user delete → 404; list/delete reachable **without** the `document_upload` entitlement (negative-gate assertion).

##### M18.3 — Web: client + "My Knowledge" page + nav
- [x] M18.3.1 `apps/web/src/lib/upload-client.ts`: add `listUploads(token, scope?)` (`GET /uploads?scope=`) and `deleteUpload(token, id)` (`DELETE /uploads/:id`), matching the existing `uploadFile` client shape + error handling.
- [x] M18.3.2 `apps/web/app/knowledge/page.tsx` ("My Knowledge"): fetch on mount; render a **Saved (persistent)** section + a **Temporary (expiring)** section (or a scope filter). Each row: filename, mode `Badge` (green=persistent / info=temporary), `formatBytes(sizeBytes)`, searchable badge (`searchableChunks` / `notSearchable`), created date; temporary rows show relative **"expires in N days"** from `expiresAt`. Per-row **Delete** with a confirm step (copy notes past answers keep their citation snapshot). Empty state → "Attach a document and choose Persistent to save it here." Loading + error states per M12.9.4 patterns. Consumer surface only — the signed-in user's own uploads. **Design parity (mockup `requirements/design/screenshots/pages/02-my-knowledge.png`, formerly M19.1.2 — merged here so one task owns this file):** wrap in `.pagehead` (`.eyebrow` "UPLOAD MANAGEMENT" + `.h1` "My Knowledge"); give each row a leading file icon + `.card` frame with the filename as `.h3`, the size in `.mono`, and the mode / searchable-chunks `Badge`s + added-date; right-align the `Delete` as a ghost `Button`. New `knowledge` key `eyebrow` (alongside the namespace added in M18.3.4). Keep ExpertOS branding; verify against screenshot 02.
- [x] M18.3.3 Sidebar entry point: add a discoverable nav link to `/knowledge` in the `apps/web` chat sidebar (near the conversation list / usage meter) so "where did my remembered file go?" is answerable in-product.
- [x] M18.3.4 i18n: new `knowledge` namespace in `apps/web/src/lib/i18n/dictionaries.ts` (EN + VI, lockstep per M13) — page title, section headers, column/relative-time labels ("expires in {count} days"), delete-confirm copy, empty state, sidebar link label. (Prune the now-orphaned `chat.optionTemporary`/`chat.optionPersistent` keys left by the M12.6.2 `.seg` change while here.)
- [x] M18.3.5 Web jest tests (`apps/web`, per M15.1): My Knowledge page renders list with mode/searchable badges, scope sections, relative expiry; delete flow (confirm → client call → row removed); empty + error states; `knowledge` dictionary key completeness (EN/VI parity).

##### M18.4 — E2E
- [x] M18.4.1 E2E (`e2e/`, per M15.3): upload a **persistent** file in chat → open My Knowledge from the sidebar → assert it appears with the green badge → delete it → assert it's gone and a fresh question no longer retrieves it. (Reuse the host-run upload fixtures from the M5 / E2E recipe.)

#### M19 — Mockup design-parity pass (25 secondary screens) — PLANNED (§"M19 — Mockup design-parity pass for the 25 secondary screens")

> **One screen per loop.** Read only §M19 in `PRD.md` + the one screenshot at `requirements/design/screenshots/pages/NN-<name>.png`. Keep **ExpertOS** branding (ignore the mockup's "J&P GLOBAL") and the **real** client/DTO — the mockup is layout / hierarchy / styling only, never sample data. Add new i18n keys in EN+VI lockstep. Verify the finished page against its single screenshot. Tasks marked **(verify+polish)** sit on already-built milestones — read that milestone first, don't rebuild.
>
> _Covers all 25 mockup screens; 24 tasks here — screen **02-my-knowledge** is owned by **M18.3.2** (design parity merged into that task so a single loop owns `apps/web/app/knowledge/page.tsx`)._

##### M19.1 — User app (`apps/web`)
- [x] M19.1.1 history (`apps/web/app/history/page.tsx`, screenshot 01) — wrap in `.pagehead` (`.eyebrow` "YOUR CONVERSATIONS" + `.h1`); add a right-aligned `.seg` Conversations / Saved-answers toggle that switches the list (not both stacked); full-width search row (`Input` + primary Search `Button`); render rows as full-width clickable `.card` items (leading chat icon, title, trailing date + chevron). Client `listConversations` / `searchConversations` / `listSavedAnswers` (`history-client.ts`); DTOs in `shared/src/chat.ts`. New `history` keys: `eyebrow`, `tabConversations`, `tabSaved`.
- [x] M19.1.2 account (`apps/web/app/account/page.tsx` + `src/components/account-panel.tsx`, screenshot 03) — add the identity header the panel lacks: `.avatar` (initials from `useAuth`) + "Account" `.h2` + email `.muted` + close ×; render the "USAGE THIS PERIOD" / "FEATURES" section labels as `.eyebrow`; confirm the `Modal` layout. Meters/badges already correct. Client `fetchEntitlements` / `fetchUpgradePlans`, `EntitlementsDto`. New `account` key: `accountTitle` (only if distinct from `heading`).

##### M19.2 — Knowledge & experts (`apps/admin`)
- [x] M19.2.1 knowledge-detail (`apps/admin/app/knowledge/[id]/page.tsx`, screenshot 04) — **(verify+polish)**: confirm `.pagehead` back-eyebrow + `.h1` + `.muted .mono` scope/lang/versions + status `Badge`, and the versions `Table` (VERSION / STATUS / CHUNKS / CHANGE SUMMARY / CREATED / ACTIONS) with `DRAFT`/`LIVE` chips + `publishStatusTone` `Badge` tones render per screenshot. Client `getDocument` / `versionAction`, `KnowledgeDocumentDetailDto`. No new keys.
- [x] M19.2.2 knowledge-drafts (`apps/admin/app/knowledge-drafts/page.tsx`, screenshot 05) — add a `.lede` subtitle under the `.h1`; keep the existing TITLE / STATUS / LANG / FROM CHAT / UPDATED `Table` (title `Link`, status `Badge`). **Omit the illustrative "· N asks" count** (no DTO field). Client `listDrafts`, `KnowledgeDraftSummaryDto`. New `knowledgeDrafts` key: `lede`.
- [x] M19.2.3 knowledge-draft-detail (`apps/admin/app/knowledge-drafts/[id]/page.tsx`, screenshot 06) — add an info-callout `.card`/`.panel` (ⓘ) above the Title field; keep Title `Input` + Content `Textarea` + action `Button`s + back-eyebrow + status `Badge`. **Omit the "N asks" count + "View source queries" link** (no DTO backing) — render the static note only. Client `getDraft` / `updateDraft` / `draftAction`, `KnowledgeDraftDto`. New `knowledgeDrafts` key: `autoDraftedNote`.
- [x] M19.2.4 experts (`apps/admin/app/experts/page.tsx`, screenshot 07) — move the "New expert" `Button` into `.pagehead` (right-aligned); add a leading `.avatar` (`avatarInitials`/`avatarTone`) cell before Name in the `Table`; render Manage as a `Button` (not a bare link); `.lede` intro. Client `listExperts` / `createExpert`, `AdminExpertSummaryDto`. No new keys.
- [x] M19.2.5 expert-detail (`apps/admin/app/experts/[id]/page.tsx`, screenshot 08) — styling/alignment pass on the **real** expert-detail data (identity + Stats + Profile/Calendar/voice-link cards): right-aligned status `Badge` in `.pagehead`, promote the two `Stat`s into a `.row` of `.stat` cards near the top, each editor section a `.card .card-pad`. (Screenshot 08 shows a draft-editor pattern — mirror its hierarchy, not its content.) Client `getExpert` / `updateExpert` / `setExpertActive`, `AdminExpertDetailDto`. No new keys.
- [x] M19.2.6 voice-profile-detail (`apps/admin/app/voice-profiles/[id]/page.tsx`, screenshot 09) — **(verify+polish, finishes open M13.5.3–5.6 visuals)**: make the reputation warning use the amber `.bar .warn`/`.card` treatment with a ⚠ glyph; ensure Approve (primary) + Request-changes (ghost) `Button`s sit in the head row; confirm `.avatar-lg` identity + status `Badge`s. Client `getVoiceProfile` / `voiceProfileAction`, `VoiceProfileDetailDto`. No new keys.

##### M19.3 — Concierge & quality (`apps/admin`)
- [x] M19.3.1 concierge-settings (`apps/admin/app/concierge/page.tsx`, screenshot 10) — replace the mode `<Select>` with three selectable radio `.card`s (Off = ink "NO TRIGGER" `Badge`; Mode A · User-prompted = crimson-bordered active card + "ACTIVE" `Badge`; Mode B · Auto-silent = amber "AWAITING OD#5 SIGN-OFF" `Badge`, **disabled** when `!silentReviewAllowed`); move Save into `.pagehead` as primary; keep the threshold / SLA / cap numeric `Field`s. Client `getConciergeConfig` / `updateConciergeConfig`, `ReviewConfigDto`. New `concierge` keys: `badgeNoTrigger`, `badgeActive`, `badgeAwaitingSignoff`, `modeOffTitle`, `modeATitle`, `modeBTitle`.
- [x] M19.3.2 concierge-analytics (`apps/admin/app/concierge-analytics/page.tsx`, screenshot 11) — lay the SLA-adherence and trigger-mode/visibility `Badge` groups into **two side-by-side titled `.panel`/`.card`s** (each an `.eyebrow` label + `Badge` chips) instead of full-width `.h3` stacks; add a green `.d` delta on the stat cards (answered-rate, sla-tracked); keep status/verdict/knowledge sections below. Client `getConciergeAnalytics`, `ConciergeAnalyticsDto`. Optional `conciergeAnalytics` key: `answeredRate`.
- [x] M19.3.3 answers (`apps/admin/app/answers/page.tsx`, screenshot 12) — render the model as a `.chip` (not an info `Badge`); add `.lede` intro; keep the answer-card feed (HELPFUL / UNHELPFUL / INSUFFICIENT / confidence `Badge`s + `.mono` timestamp + QUESTION/ANSWER blocks). Client `getExpertAnswers` / `listExperts`, `ExpertAnswerReviewDto`. Update `answers` keys: `eyebrow`→"Render quality feed", `heading`→"Answer review" (EN+VI).
- [x] M19.3.4 failed-queries (`apps/admin/app/failed-queries/page.tsx`, screenshot 13) — add a per-card primary "Draft knowledge" action (not present today); swap the `.muted` intro for `.lede`; align copy (eyebrow "CONTENT ROADMAP · INSPECTOR", title "Failed queries", reason label "REASON FLAGGED"). Keep the badge-row + `.label` QUESTION/ANSWER/REASON card feed + Load-more. Client `getFailedQueries`, `FailedQueryDto`. New `failedQueries` key: `draftKnowledge`; update `eyebrow`/`title`/`intro`/`reason`.
- [x] M19.3.5 validation (`apps/admin/app/validation/page.tsx`, screenshot 14) — add a section-level `.eyebrow` above each `.h3` (ACTIVATION / ENGAGEMENT / WTP / FUNNEL); reword section headings as questions; emphasize the hypothesis phrase in the intro (`<em>`); retitle to "Product validation". Keep the per-section `.row gap1` `Stat` grids. Client `getValidationAnalytics`, `ValidationAnalyticsDto`. New `validation` keys: `activationEyebrow`, `engagementEyebrow`, `wtpEyebrow`, `funnelEyebrow`; update `heading`/`intro`/section headings.

##### M19.4 — Growth & revenue (`apps/admin`)
- [x] M19.4.1 analytics (`apps/admin/app/analytics/page.tsx`, screenshot 18) — **(verify+polish — this is the reference recipe)**: confirm the 5-`Stat` row + byFeature/byModel/byDay `.h3` `Table`s; right-align numeric columns; update copy `eyebrow`→"AI cost & token usage", `title`→"Usage analytics". Client `getUsageAnalytics`, `UsageAnalyticsDto`. Copy keys only.
- [x] M19.4.2 funnel (`apps/admin/app/funnel/page.tsx`, screenshot 19) — **the worked template (full spec in §M19):** add the "STAGE ATTRIBUTION" `.card` of horizontal `Bar` rows (Conversations → Recommendations → Booked → Consultations → Revenue; proportional fills + `count · NN.N%` vs the prior stage) above the existing breakdowns; keep the KPI `Stat` row. Client `getFunnelAnalytics`, `FunnelAnalyticsDto` (reuse the existing `rate()` / `usd()` helpers). New `funnel` keys: `stageAttribution`, `stageConversations`, `stageRecommendations`, `stageBooked`, `stageConsultations`, `stageRevenue`.
- [x] M19.4.3 conversions (`apps/admin/app/conversions/page.tsx`, screenshot 17) — right-align the "By trigger" count column (`.mono`); `.lede` intro; align copy (eyebrow "M8.5 · YOUR VOICE → CONSULTATIONS", title "Conversions"). Keep the 3-`Stat` row + byResponse/byStatus + recent tables (a superset of the mockup — fine). Client `getExpertConversions` / `listExperts`, `ExpertConversionsDto`. Update `conversions` `eyebrow`/`title`/`intro`.
- [x] M19.4.4 recommendation-rules (`apps/admin/app/recommendation-rules/page.tsx`, screenshot 15) — restyle the per-row enable control from a raw checkbox to a `.switch` pill; render the left-cell trigger-kind as an uppercase `Chip` ("KEYWORD"); `.lede` intro; update eyebrow to "WHEN TO RECOMMEND A CONSULTATION". Keep the TRIGGER | CONFIGURATION `Table` + `RuleEditor` fields. Client `getRecommendationRules` / `updateRecommendationRule`, `RecommendationRulesDto`. Update `recommendationRules` `eyebrow`.
- [x] M19.4.5 reconcile (`apps/admin/app/reconcile/page.tsx`, screenshot 16) — switch the "Run reconcile" card label from `.label` to `.eyebrow`; `.lede` intro; align copy (eyebrow "M7.3 · OD#10 · TIDYCAL", title "Reconcile bookings"). Keep the since-`Input` + primary `Button` + result `Stat` row + unmatched `.h2` `Card` feed. Client `reconcileBookings` / `getUnmatchedBookings`, `BookingReconcileResultDto` + `UnmatchedBookingEventDto`. Update `reconcile` `eyebrow`/`heading`.
- [x] M19.4.6 retention (`apps/admin/app/retention/page.tsx`, screenshot 25) — add the `.muted` "In production a Cloud Scheduler job hits this same endpoint on a cadence." note beside the action buttons; thousands-format the `Stat` numbers (`toLocaleString`). Keep the ELIGIBLE-NOW card + 5-`Stat` row + Refresh / Run-sweep `Button`s + result card. Client `getRetentionPreview` / `runRetentionSweep`, `RetentionPreviewDto`. New `retention` key: `cronNote`.

##### M19.5 — Platform (`apps/admin`)
- [ ] M19.5.1 users (`apps/admin/app/users/page.tsx`, screenshot 20) — render "Manage" as a `Button` (not a `.navitem` link); render the premium plan as a colored `.badge` (not plain text); `.lede` intro. Keep the role `Select` + search `Input` + Apply + EMAIL / NAME / ROLE / PLAN / JOINED / Manage `Table`. Client `listUsers`, `AdminUserSummaryDto`. No new keys.
- [ ] M19.5.2 user-detail (`apps/admin/app/users/[id]/page.tsx`, screenshot 21) — add the "← Back to users" eyebrow link (currently missing); confirm the 3 `.stat` cards (conversations / uploads / consultations) + Subscription / Role / FairUse / Deletion `.card` sections. Client `getUser`, `AdminUserDetailDto`. New `users` key: `detail.back`.
- [ ] M19.5.3 access-control (`apps/admin/app/access-control/page.tsx`, screenshot 22) — **(verify+polish, M14.4.3)**: wrap the add-form row in a `.card .card-pad` panel; bold the "admin" / "expert" words in the intro (markup). Keep the email + role + Add form + `Table`. Client `listAllowedEmails` / `addAllowedEmail` / `updateAllowedEmail` / `removeAllowedEmail`, `AllowedEmailDto`. No new keys.
- [ ] M19.5.4 audit (`apps/admin/app/audit/page.tsx`, screenshot 23) — align copy to the mockup (eyebrow "EVERY PRIVILEGED ACTION, RECORDED", subtitle "Who did what, when. Immutable — for compliance and incident review."); keep the WHEN / ACTOR / ACTION (`.badge-ink`) / TARGET / DETAIL `Table` + Load-more. Client `getAuditLogs`, `AdminAuditLogDto`. Update `audit` `eyebrow`/`subtitle`.
- [ ] M19.5.5 settings (`apps/admin/app/settings/page.tsx`, screenshot 24) — **(verify+polish, M17.5)**: add a primary Save in the `.pagehead` (top-right) mirroring the existing bottom one; wrap the fields in a `.card .card-pad`; render the score-floor "GUIDE" as a `.chip` by the label. Keep the temp / model / scoreFloor / embedding `Field`s. Client `getAppSettings` / `updateAppSettings`, `AppSettingsDto`. Optional `settings` key: `scoreFloorGuide`.

### Phase 2 — Retention & Engagement (§"Phase 2 — Retention & Engagement") — not started
- [ ] Deferred: CI/CD pipeline, mobile (React Native), notifications, voice/TTS, folders/export, follow-up suggestions, confidence indicator, personalized memory, persistent user/customer knowledge, consultation depth, reconciliation dashboard

### Phase 3 — Scale & Enterprise (§"Phase 3 — Scale & Enterprise") — not started
- [ ] Deferred: B2B multi-tenant activation, expert marketplace, team workspaces, SSO, native booking, ingestion expansion, integrations, self-hosted models

