# Feedbacks

## Latest Review Verdicts (read this section first — stop at the breaker line)

### Security: Cycle 2 — FAIL (2026-06-03)
- auth & access control: FAIL (removed/demoted whitelist entries do not revoke mirrored API roles)
- data exposure / secrets: FAIL (expert voice is not a knowledge boundary; raw upload objects are not deleted with retention/user deletion)
- input validation: PASS (zod route validation, constant raw SQL with bound params, citation-marker neutralization, webhook raw-body signature checks)
- dependency / supply chain: PASS (no new dependency risk reviewed in latest changes)
- Critical: stale admin/expert roles can keep calling privileged APIs after whitelist removal
- Critical: selected expert voice can answer from another expert/global published knowledge
- Critical: document-upload entitlement is defined but not enforced before parse/embed work
- High: retention/user deletion removes DB rows but not raw upload objects
- High: TidyCal fallback idempotency can skip later cancel/reschedule lifecycle events

### Code Review: Cycle 0 — (no review yet)
- (awaiting first code review)

### Product Review: Cycle 1 — FAIL (2026-06-03)
- requirements coverage: FAIL (uncited real-LLM answers can bypass insufficient-knowledge handling, review, and escalation)
- core user flow: FAIL
- data handling / privacy: PASS
- High: citationless answers can still be delivered as ordinary expert answers without the honest limitation state

---

## Daily Architecture Review — Cycle 2 (2026-06-03)

**Reviewer:** Senior Solution Architect
**Scope:** `apps/api/src/`, `apps/web/`, `apps/admin/`, `packages/shared/src/`, `packages/db/prisma/`, `packages/db/src/`, `packages/ai/src/`, `infra/`, `e2e/`, dependency manifests, migrations, environment handling, logging/analytics/retention behavior, `project-mds/DIRECTIVES.md`, `project-mds/progress-state.md`, relevant PRD/progress sections, and recent architecture-sensitive commits on `main`. Per instruction, nothing under `requirements/` was read or referenced.
**Verdict: FAIL** — multiple issues can plausibly cause unauthorized privileged access, expert-reputation damage, entitlement abuse, unbounded AI/embedding cost, stale booking state, and private-data retention beyond policy.

### Critical — Admin whitelist removal does not revoke API privilege

**File refs:** `apps/api/src/admin/access-control.service.ts:132`, `apps/api/src/auth/admin-session.service.ts:23`, `apps/api/src/auth/roles.guard.ts:23`, `apps/api/src/auth/rls.service.ts:23`

`AccessControlService.remove` deletes the `allowed_emails` row, and `updateRole` only changes the whitelist entry. The privileged API boundary, however, checks only the mirrored `users.role` via `RolesGuard`; it does not re-check the whitelist. `AdminSessionService` syncs roles on portal sign-in, but a previously whitelisted admin/expert whose email is later removed or demoted can bypass the UI and keep calling protected APIs directly with a valid Firebase token. For admins, `RlsService` then sets `is_admin`, widening reads/writes under RLS.

**Architectural consequence:** invite-only admin/expert access is partly a UI/session gate rather than an API source-of-truth gate. A stale privileged account can retain elevated access to users, subscriptions, analytics, retention actions, knowledge, voice, and concierge surfaces.

**Recommended remediation:** make the server-side authorization guard for `admin`/`expert` routes verify `allowed_emails` as the source of truth, or synchronously downgrade the matching `users.role` when whitelist entries are removed/demoted. Add tests proving a removed admin cannot call an `@Roles("admin")` API without re-signing through the portal.

### Critical — Selected expert voice is not a knowledge boundary

**File refs:** `apps/api/src/chat/chat.service.ts:371`, `apps/api/src/retrieval/pgvector.store.ts:112`, `packages/shared/src/retrieval.ts:23`, `packages/db/prisma/schema.prisma:560`, `apps/api/src/ingestion/document-version.repository.ts:130`

`expertId` affects voice retrieval and conversation persistence, but knowledge retrieval filters only chunk `status`, optional `language`, and optional `scope`. `Document` has an optional `expertId`, but ingestion never sets it, `Chunk` does not denormalize it, and `PgVectorStore` does not join back through `document_versions -> documents` to enforce an expert predicate. A user can therefore select Expert A's published voice while retrieval grounds the answer in another expert's/global published knowledge.

**Architectural consequence:** the system can produce a cited, fluent answer in a named expert's voice that the expert did not sign off on. That undermines the reputation boundary and the promise that voice is layered over that expert's approved facts.

**Recommended remediation:** add explicit expert-scoped retrieval semantics. Either denormalize `expert_id` onto chunks or join through `document_versions` and `documents`; pass selected `expertId` into retrieval filters; define whether global/shared knowledge is allowed for all experts or only as a clearly labeled secondary corpus. Update cache keys and invalidation to include the expert knowledge scope.

### Critical — Document-upload entitlement is defined but not enforced

**File refs:** `apps/api/src/uploads/upload.controller.ts:40`, `packages/db/prisma/seed.ts:64`, `apps/api/src/entitlements/entitlement.guard.ts:38`, `apps/api/src/uploads/upload.service.ts:171`

The entitlement catalog defines `document_upload` and disables it for Free, but `POST /uploads` has only `@Roles("user")`. The upload path validates, scans, parses, chunks, and embeds before persisting. Generic per-IP throttling and a 10 MiB size cap help, but they do not enforce plan access or reserve-before-work economics.

**Architectural consequence:** any authenticated user can trigger repeated upload embedding and parsing work, bypassing subscription behavior and creating a cost-amplification path.

**Recommended remediation:** add `@RequiresEntitlement("document_upload")` to the upload route. Prefer making upload use metered by file, chunk, or token volume, with reserve-before-work before parsing/embedding and hard caps on chunks per upload.

### High — Retention and user deletion do not delete raw upload objects

**File refs:** `apps/api/src/admin/retention.service.ts:98`, `apps/api/src/admin/admin-user.service.ts:318`, `apps/api/src/uploads/storage-provider.ts:14`, `infra/storage.tf:3`

Retention sweeps delete expired `uploaded_files` rows and user deletion cascades database rows, but `StorageProvider` has only `put`; no delete operation exists. The GCS bucket is private and versioned, but has no lifecycle rule. Raw private upload bytes can remain in object storage after database rows are gone.

**Architectural consequence:** private data can be retained beyond policy and storage cost can grow invisibly. Deleting the database pointer prevents normal app access, but does not fulfill data ownership or retention promises for the underlying object.

**Recommended remediation:** extend `StorageProvider` with delete/deleteMany and call it before/after DB deletion with retry-safe audit. Add GCS lifecycle rules for temporary upload prefixes and noncurrent object versions. Track orphan cleanup as a scheduled or admin-triggered operation.

### High — TidyCal fallback idempotency can skip later lifecycle events

**File refs:** `apps/api/src/consultation/http-tidycal-provider.ts:92`, `apps/api/src/consultation/booking.service.ts:185`

When TidyCal webhook payloads do not include a delivery-unique event id, `HttpTidyCalProvider` falls back to `bookingRef`. `BookingService` idempotency is keyed by `(provider, eventId)`, so a later cancellation or reschedule for the same booking can be treated as a duplicate and skipped.

**Architectural consequence:** consultation status, schedule, and revenue attribution can become stale or wrong after booking lifecycle changes.

**Recommended remediation:** require a provider event id when available and reject malformed lifecycle events, or build fallback ids from booking ref plus event type plus lifecycle timestamp. Add tests for created -> rescheduled -> canceled with no webhook `id`.

### Medium — Duplicate query embeddings for upload-assisted chat

**File refs:** `apps/api/src/chat/chat.service.ts:94`, `apps/api/src/retrieval/retrieval.service.ts:72`, `apps/api/src/retrieval/retrieval.service.ts:113`

For upload-assisted chat, the same question is embedded once for upload retrieval and again for knowledge retrieval. This is documented as a deliberate seam split, but with real embedding providers it doubles one of the recurrent per-turn costs whenever uploads are in play.

**Architectural consequence:** cost and latency grow unnecessarily for a high-value paid feature.

**Recommended remediation:** compute the query embedding once per turn and pass it to both retrieval stores, while preserving independent usage logging for observability.

### Positive Architecture Posture

- Global auth, RBAC, entitlement, and rate-limit guards are registered server-side.
- RLS context is transaction-local and uses bound parameters with UUID validation.
- Published knowledge retrieval is status-gated, and unresolvable citation markers are stripped before persistence.
- Prompt construction centralizes instruction hierarchy and forged citation-marker neutralization.
- Stripe webhook verification uses raw body, timestamp tolerance, and constant-time HMAC comparison.
- TidyCal webhooks have HMAC verification and an idempotency ledger, aside from the fallback id issue above.
- Cache invalidation pins tenant deletes even under admin RLS bypass.

### Residual Risks and Unverified Assumptions

- The live E2E stack and live DB integration suites were not run in this review.
- Provider timeout/retry behavior needs a focused follow-up: Stripe, TidyCal, and LLM fetch paths rely on default `fetch` behavior without explicit abort deadlines.
- The review sampled latest architecture-sensitive commits and baseline critical paths; it was not a line-by-line audit of every UI page.

### Final Verdict

FAIL. The current architecture has credible paths to stale privileged access, expert/knowledge misattribution, upload entitlement abuse, private-data retention beyond policy, and stale booking lifecycle state.

---

## Product Review — Cycle 1 (2026-06-03)

**Reviewer:** Product & Business Review Lead
**Scope:** `project-mds/FEEDBACKS-INSTRUCTIONS.MD`, the Latest Review Verdicts block, relevant PRD/progress-state sections, and recent product-sensitive implementation changes on `main`. Per instruction, nothing under `requirements/` was read or referenced.
**Verdict: FAIL** — ExpertOS currently has a credible path to a fluent answer with no resolved citations being treated as an ordinary delivered answer.

### High — Citationless model output bypasses honest limitation, concierge review, and escalation

The chat pipeline correctly strips unresolvable citation markers and persists only citations that resolve to retrieved chunks, but the product-level insufficient-knowledge signal is still based on `facts.length === 0`, not on whether the final answer has any resolved citations. In `apps/api/src/chat/chat.service.ts:180` the final text is sanitized through `buildCitations`, and `built.citations` can be empty even when retrieval found facts. However the turn then sends `insufficientKnowledge: facts.length === 0` to concierge review, recommendation routing, and the client at `apps/api/src/chat/chat.service.ts:251`, `apps/api/src/chat/chat.service.ts:261`, and `apps/api/src/chat/chat.service.ts:270`.

Product consequence: if a real OpenAI/Anthropic/Gemini response omits citations, cites only stripped markers, or answers from nearby retrieved context without attaching markers, the user can receive a polished answer with zero verifiable support and no amber insufficient-knowledge notice. The UI only shows that notice when `message.insufficientKnowledge` is true (`apps/web/app/chat/page.tsx:457`), so this path silently loses the product's "I do not know, here is why" behavior. The answer is not cache-pinned, which is good, but it is still persisted, displayed, eligible for feedback, and can appear in history as a normal answer.

This also weakens the business-quality loops. Silent concierge review only triggers on `insufficientKnowledge` or a non-null confidence score (`apps/api/src/concierge/concierge-queue.service.ts:125`), while chat always passes `confidence: null`. Consultation routing receives the same `facts.length === 0` insufficient flag, so low-confidence rules depend only on citation count thresholds and admin configuration instead of the hard product rule that an uncited answer is not trustworthy. This is especially risky now that real model drivers were added behind the LLM seam; prompt instructions are helpful, but the product cannot rely on model obedience for the trust contract.

Required product fix: treat `built.citations.length === 0` as an insufficient or ungrounded final-answer state unless the answer is an explicit refusal/insufficient-knowledge response. The final state should drive the user notice, concierge queue, consultation recommendation, analytics, persistence metadata, and tests. A stricter option is to replace uncited non-refusal prose with a canned insufficient-knowledge response before persistence.

### Medium — Operator analytics overstate answer quality by reducing trust to citation count

The questions-answered report explicitly buckets answers by citation count only: grounded is `>=2`, low-confidence is `1`, and insufficient is `0` (`apps/api/src/analytics/analytics.service.ts:266`, `apps/api/src/analytics/analytics.service.ts:712`). That is directionally useful, but it can overstate product quality because it does not distinguish exact-passage support, high-stakes caution, upload-vs-published provenance, user feedback, concierge verdicts, or citation-marker stripping events. A two-citation answer can still be weakly supported or unsupported in substance.

Product consequence: operators may read "grounded" as "trustworthy enough" and make retention, conversion, or content-roadmap decisions from a metric that is more precise-looking than it is. The dashboard should label this as "2+ resolved citations" or combine it with stronger quality signals such as bad feedback, source flagging, insufficient final-answer state, and concierge edits.

### Medium — The "Verified" badge can imply more than citation resolvability

The chat UI marks an answer as `Verified` whenever it is done, has at least one citation, and is not marked insufficient (`apps/web/app/chat/page.tsx:444`). That badge is easy for a user to interpret as expert-verified or fact-verified, while the actual guarantee is narrower: at least one citation resolved to a chunk. This matters because ExpertOS sells named-expert trust, and "Verified" near an expert voice can feel like expert endorsement.

Product consequence: expert reputation risk increases when a partially cited answer appears visually certified. The badge should be renamed toward the real guarantee, such as "Citations resolved", or require stronger evidence before using "Verified".

### Positive Trust Posture

- Published-knowledge retrieval is filtered to `status: published`, which supports the expert-review promise.
- Unresolvable citation markers are stripped before persistence, preventing dangling citations from being shown as evidence.
- Upload citations carry a distinct kind and source label, and temporary upload retrieval is scoped to the current conversation and expiry-filtered.
- High-stakes questions receive both prompt-level educational-scope constraints and a UI disclaimer.
- Voice profiles are only retrieved from published profiles of active experts, preserving the sign-off boundary.

### Product Verdict

FAIL. The current product can still deliver a fluent answer without resolved citations and without the honest limitation state. Because the core ExpertOS promise is grounded, cited expert knowledge, this must fail until final-answer citation absence is treated as a trust event, not just a cache-storage detail.

---

## Security Review — Cycle 1 (2026-06-01)

**Reviewer:** automated `/security-review` (`/cso` audit, M11.2)
**Scope:** full branch `m7.2-consultation-booking` diff vs `main` (~17.9k insertions, 142 files): M3–M8 milestones, consultation/booking funnel + TidyCal webhook, admin & expert portals, raw-SQL reporting services, billing/entitlements, per-IP rate limiter, prompt-injection hardening, DB migrations/RLS.

**Verdict: PASS — no HIGH or MEDIUM confidence vulnerabilities found.**

Methodology: identification sub-task over the full diff + repo context, then independent verification of the highest-risk paths (raw SQL, elevated RLS reads, webhook HMAC).

Verified safe:
- **SQL injection** — `revenue.service.ts` (`PERIOD_SQL`), `expert-portal.service.ts` (`ANSWERS_SQL`), `failed-query.service.ts` (`INSPECTOR_SQL`) all use constant SQL strings with bound `$1..$N` placeholders; no request value is string-interpolated. `applyRlsContext` validates UUIDs before binding.
- **Elevated-but-bounded RLS** — `expert-portal.service.ts` runs under the `is_admin` GUC but re-bounds every query with explicit `c.tenant_id = $1::uuid AND c.expert_id = $2::uuid`; `resolveExpert` scopes a non-admin to their own linked `Expert` and short-circuits to empty when none resolves, so a query can never widen to the tenant.
- **`@Roles` guards** — every new `admin/*` route is `@Roles("admin")`; expert routes `@Roles("expert")`; the consumer recommendation-respond route is user-scoped via RLS ownership; the only `@Public()` route (`consultation-bookings/webhook`) is authenticated by HMAC.
- **Webhook HMAC** — `verifyWebhook` rejects a missing signature, computes HMAC-SHA256 over the raw body, compares with `timingSafeEqual` behind a length guard, and only `JSON.parse`s after verification succeeds.
- **Server-chosen redirects** — TidyCal booking link derived server-side from consultation-type config, never client-supplied.
- **Cross-tenant cache invalidation** — `ResponseCacheService.invalidateTenant` pins `deleteMany` to `user.tenantId` despite the admin GUC.
- **Prompt injection** — instruction-hierarchy rule + forged-`[n]` neutralization (hardening, not a regression).
- **New RLS-exempt tables** — `recommendation_rules` (admin-write config) and `booking_webhook_events` (system-write/admin-read) match the existing `plan_entitlements`/`transactions` posture.
- **XSS** — no `dangerouslySetInnerHTML` in any source `.tsx`.

Out of scope (skill exclusions), noted but not flagged: rate limiter `X-Forwarded-For` trust (DoS/rate-limiting; defense-in-depth under a trusted edge); per-tenant answer cache key (pre-existing M6.4 design).

---

# Detailed Review History (reference only — read specific entries when you need context)

(empty)
