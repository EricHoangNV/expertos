# Feedbacks

## Latest Review Verdicts (read this section first — stop at the breaker line)

### Security: Cycle 2 — FAIL (2026-06-03)
- auth & access control: FAIL (removed/demoted whitelist entries do not revoke mirrored API roles) — REMEDIATED 2026-06-03, pending re-review (see remediation note below)
- data exposure / secrets: FAIL (expert-voice-knowledge-boundary + raw-upload-object deletion both REMEDIATED 2026-06-03, pending re-review)
- input validation: PASS (zod route validation, constant raw SQL with bound params, citation-marker neutralization, webhook raw-body signature checks)
- dependency / supply chain: PASS (no new dependency risk reviewed in latest changes)
- Critical: stale admin/expert roles can keep calling privileged APIs after whitelist removal — REMEDIATED 2026-06-03, pending re-review
- Critical: selected expert voice can answer from another expert/global published knowledge — REMEDIATED 2026-06-03, pending re-review (see remediation note below)
- Critical: document-upload entitlement is defined but not enforced before parse/embed work — REMEDIATED 2026-06-03, pending re-review (see remediation note below)
- High: retention/user deletion removes DB rows but not raw upload objects — REMEDIATED 2026-06-03, pending re-review (see remediation note below)
- High: TidyCal fallback idempotency can skip later cancel/reschedule lifecycle events — REMEDIATED 2026-06-03, pending re-review (fallback eventId now `fallback:<ref>:<type>:<lifecycleStamp>`, distinct per transition)

### Code Review: Cycle 0 — (no review yet)
- (awaiting first code review)

### Product Review: Cycle 1 — FAIL (2026-06-03)
- requirements coverage: FAIL (uncited real-LLM answers can bypass insufficient-knowledge handling, review, and escalation) — REMEDIATED 2026-06-03, pending re-review (`ChatService` now keys the insufficient/ungrounded state off `built.citations.length === 0`, not `facts.length === 0`)
- core user flow: FAIL — REMEDIATED 2026-06-03, pending re-review
- data handling / privacy: PASS
- High: citationless answers can still be delivered as ordinary expert answers without the honest limitation state — REMEDIATED 2026-06-03, pending re-review (see remediation note below)

---

## Developer Remediation Note (2026-06-03) — Security Cycle 2 High: TidyCal fallback idempotency can skip later cancel/reschedule lifecycle events

**Author:** implementing agent (not a review cycle). Addresses the Security Review Cycle 2 High "TidyCal fallback idempotency can skip later cancel/reschedule lifecycle events" (auth/data-integrity category). Last open in-sandbox-codeable FAIL in the Security Cycle 2 verdict.

**Root cause:** `BookingService` keys idempotency on `booking_webhook_events.[provider, eventId]`. When a TidyCal webhook omits a delivery-unique `id`, `HttpTidyCalProvider.parseEvent` fell back to `eventId = normalized.bookingRef` (`http-tidycal-provider.ts:93`). All lifecycle events for one booking — `created`, then `rescheduled`, then `cancelled` — therefore shared the same `eventId`, so every event after the first was treated as a duplicate and skipped. Consequence: a consultation's status, schedule, and revenue attribution go stale after a reschedule/cancel that arrives without a webhook id. The offline driver (`offline-tidycal-provider.ts:68`) had the same `eventId ?? bookingRef` collision class (dev/test-only, trusted envelopes, but a latent bug).

**Fix:** the fallback eventId is now synthesized per-transition, not per-booking — `fallback:<bookingRef>:<eventType>:<lifecycleStamp>`:
- `HttpTidyCalProvider.parseEvent` prefers a non-empty `rawEvent.id`, else calls `fallbackEventId(booking, normalized)`. `lifecycleStamp` picks the timestamp that actually advances on *this* transition (cancel → `cancelled_at`/`updated_at`; reschedule → `rescheduled_at`/`updated_at`; create → `created_at`/`updated_at`), falling back to the new `scheduledAt` (which moves on a reschedule) and finally `na`. So `created`/`rescheduled`/`cancelled` for one booking get three distinct keys, and two reschedules differ via the new scheduled time — while a redelivery of the *same* transition is byte-identical, preserving idempotency.
- `parseOfflineBookingEvent` mirrors it (`fallback:<ref>:<type>:<scheduledMs|na>`) so the offline path can't drift; an explicit envelope `eventId` still wins.
- `BookingEvent.eventId` doc updated; `BookingService` unchanged (the key is now correct at the source).

**Why not reject malformed events:** the reviewer offered "reject malformed lifecycle events" as an alternative. Dropping an event would defeat the OD#10 no-vanish guarantee (a cancel with no usable timestamp would silently disappear). Synthesizing a best-effort distinct key keeps the event in the ledger; the `na` backstop only collapses two *timestamp-less same-type* transitions, which TidyCal does not emit (a reschedule always carries a new `starts_at`).

**Tests:** `http-tidycal-provider.test.ts` (+5): created→rescheduled→cancelled with no webhook id get 3 distinct ids, same-transition redelivery is byte-identical (idempotent), two reschedules differ via scheduled time, `na` backstop when no timestamp, a delivery-unique `id` still wins; updated the prior "falls back to bookingRef" case. `offline-tidycal-provider.test.ts` (+1, 1 updated): per-transition fallback + 3-distinct-id lifecycle. Full `@expertos/api` suite 722 pass; consultation files 100% stmts/funcs/lines. Gates: api build + eslint + jest (coverage) + root knip green. (LEARNINGS #31, DIRECTIVES #47.)

---

## Developer Remediation Note (2026-06-03) — Security Cycle 2 High: Retention/user deletion removes DB rows but not raw upload objects

**Author:** implementing agent (not a review cycle). Addresses the Security Review Cycle 2 High "retention/user deletion removes DB rows but not raw upload objects" (data-exposure category).

**Root cause:** the `StorageProvider` seam (`apps/api/src/uploads/storage-provider.ts`) only had `put` — there was no way to delete a stored object. So both deletion paths dropped only the *DB rows*: `RetentionService.sweep` `deleteMany`'d expired `uploaded_files` (chunks cascade), and `AdminUserService.executeDeletion` hard-deleted the user (Postgres `ON DELETE CASCADE` drops `uploaded_files`). The raw bytes recorded on `uploaded_files.gcs_uri` were never reclaimed — the objects outlived the rows in GCS indefinitely, defeating the NT.3 auto-delete promise and the GDPR "delete ALL user data" directive (#16).

**Fix:**
- Added `delete(uri)` to the `StorageProvider` interface + `InMemoryStorageProvider` (idempotent — deleting a missing object is a no-op, so a re-run sweep is safe; tolerates the `memory://` scheme or a bare key).
- New shared `StorageModule` (`apps/api/src/uploads/storage.module.ts`) provides the single `STORAGE_PROVIDER` instance and is imported by both `UploadModule` and `AdminModule`, so the upload write path and the cleanup paths operate on one store (a put is deletable by retention).
- New `deleteStorageObjects(storage, uris, logger, ctx)` helper (`apps/api/src/uploads/storage-cleanup.ts`): best-effort, non-fatal per-object loop run *outside* the deleting tx (rows are source of truth → drop them first, reclaim bytes after; a storage hiccup is logged + swallowed, not allowed to abort the purge; null/empty URIs skipped).
- `RetentionService.sweep` now `findMany`s the expiring uploads' `gcsUri`s *before* the `deleteMany` (which returns only a count), and after the tx commits calls `deleteStorageObjects`.
- `AdminUserService.executeDeletion` now `findMany`s the user's upload `gcsUri`s before the cascade, and after commit calls `deleteStorageObjects`.

**Why outside the tx:** deleting the object inside the tx would let a storage failure roll back the row purge; deleting before the row purge would risk orphaning a live row if the tx rolled back. Collect-URIs-in-tx → delete-rows-in-tx → commit → reclaim-objects is the only ordering that never leaves a row pointing at a deleted object.

**Production note:** the offline default is `InMemoryStorageProvider`; a production GCS driver (still to be written, behind `createDefaultStorageProvider`) must implement `delete` by issuing a bucket object delete for the `gs://…` URI. The seam + callers are now ready for it.

**Tests:** +10 `@expertos/api` (716 total). `storage-provider.test.ts` (delete round-trip / idempotent no-op / bare-key); new `storage-cleanup.test.ts` (success count, null-skip, swallow-and-continue on throw); `retention.service.test.ts` (collects URIs before delete, deletes them post-commit, best-effort on throw); `admin-user.service.test.ts` (collects + deletes user objects post-cascade, best-effort on throw). Gates: api build + eslint + jest (coverage) + root knip green.

---

## Developer Remediation Note (2026-06-03) — Product Cycle 1 High: Citationless answers bypass the honest limitation state

**Author:** implementing agent (not a review cycle). Addresses the Product Review Cycle 1 High "citationless answers can still be delivered as ordinary expert answers without the honest limitation state."

**Root cause:** the chat pipeline correctly enforces the M4.1 chunk-resolvability guarantee — `buildCitations` strips any unresolvable marker and keeps only citations that resolve to a retrieved chunk — but the product-level insufficient/ungrounded signal was still computed as `facts.length === 0` (did retrieval find anything), not from the *final* answer's resolved citation count. So a fluent real-LLM reply that cited nothing (forged/stripped markers, or answered from nearby context without attaching a marker) was treated as an ordinary grounded answer: `insufficientKnowledge: false` flowed to the client (no amber notice), to the concierge silent-review trigger (`enqueueIfTriggered`), and to consultation routing (`recommend`). The trust contract cannot rely on model obedience now that real OpenAI/Anthropic/Gemini drivers sit behind the LLM seam.

**Fix:** in `apps/api/src/chat/chat.service.ts` the live answer path now derives a single `ungrounded = built.citations.length === 0` right after `buildCitations`, and threads it through all three downstream seams in place of `facts.length === 0` — the `done` event's `insufficientKnowledge`, the concierge `enqueueIfTriggered`, and the consultation `recommend` call. `built.citations.length` counts both knowledge and upload citations, so a genuinely upload-grounded answer stays grounded; an uncited answer (even with facts retrieved) now surfaces the honest insufficient-knowledge notice, fires Mode-B silent concierge review, and feeds the low-confidence consultation rule. Caching was already correct (write-through already gated on `built.citations.length > 0`), so an uncited answer stays unpinned. Persistence read paths (failed-query inspector, expert portal) already derive insufficiency from empty `source_version_ids`, consistent with an uncited knowledge answer.

**Not changed (separate Mediums, deferred):** the operator "grounded = ≥2 citations" analytics bucket label and the UI "Verified" badge wording are distinct Medium findings, not this High; left for a follow-up so this remediation stays scoped to the trust-event fix.

**Tests:** new regression test in `apps/api/src/chat/chat.service.test.ts` — "treats a citationless answer (facts retrieved, none cited) as ungrounded across every seam" asserts the `done` event reports `insufficientKnowledge: true` with no citations, the concierge enqueue + consultation recommend both receive the ungrounded signal, and the answer is persisted but not cached. Full `@expertos/api` suite 706 pass. Gates: api build + eslint + jest (coverage) + root knip green.

---

## Developer Remediation Note (2026-06-03) — Critical: Document-upload entitlement is not enforced

**Author:** implementing agent (not a review cycle). Addresses the Security Cycle 2 / Architecture Cycle 2 Critical "document-upload entitlement is defined but not enforced before parse/embed work."

**Root cause:** the entitlement catalog defines `document_upload` (boolean) and disables it for Free, but `POST /uploads` carried only `@Roles("user")`. The route's validate→scan→parse→chunk→embed→store pipeline therefore ran for any authenticated user regardless of plan — a cost-amplification path the per-IP throttle and 10 MiB size cap don't close.

**Fix (reserve-before-work):** added `@RequiresEntitlement("document_upload")` to `UploadController.create` (`apps/api/src/uploads/upload.controller.ts`). The global `EntitlementGuard` is a NestJS guard, and guards run **before** interceptors, so the entitlement check fires before the `FileInterceptor` even buffers the multipart body and before any service work — a disabled boolean entitlement (Free) is rejected with `402` + an upgrade payload at the wall (`EntitlementService.enforce` → `deny(..., "feature_disabled")`). Plus/Premium have the feature enabled → allowed. No new service logic; reuses the same M6.1 choke point chat already gates through.

**Note on the metered upsell:** the reviewer suggested *metering* uploads by file/chunk/token volume with hard caps per upload. That's a larger product/economics change (a new metered feature + per-upload chunk cap) deferred as a follow-up; this remediation closes the access-control gap the Critical names — an unentitled user can no longer trigger upload embedding work at all.

**Tests:** new `apps/api/src/uploads/upload.controller.test.ts` (+3) asserts the `document_upload` entitlement metadata is present on the route (the security guarantee), plus the controller's file-required guard and multipart→service delegation. Full `@expertos/api` suite 705 pass. Gates: api build + eslint + jest (coverage) + root knip green.

**Not addressed here (still open in the Security Cycle 2 verdict):** raw-upload-object deletion on retention/user-deletion, TidyCal fallback idempotency.

---

## Developer Remediation Note (2026-06-03) — Critical: Selected expert voice is not a knowledge boundary

**Author:** implementing agent (not a review cycle). Addresses the Security Cycle 2 / Architecture Cycle 2 Critical "selected expert voice can answer from another expert/global published knowledge."

**Root cause:** `expertId` drove voice retrieval, prompt persona, and conversation persistence, but knowledge retrieval (`PgVectorStore`) filtered chunks only by `status`/`language`/`scope` — no expert predicate. `Document.expert_id` existed but no flow set it, `Chunk` didn't denormalize it, and the store never joined back to it. So Expert A's voice could ground a cited answer in Expert B's / global knowledge A never signed off on.

**Scope policy (the decision the review asked for):** unattributed knowledge (`documents.expert_id IS NULL`) is the **shared global corpus** available to every voice; a document attributed to an expert is **that expert's own** and retrievable only under that expert's voice (or the neutral voice). When a voice is selected, retrieval admits `expert_id = $selected OR expert_id IS NULL`, never another expert's. This preserves the single-expert-launch behavior (all current knowledge is unattributed → still shared) while making per-expert private knowledge enforceable the moment a document is attributed.

**Fix:**
- `expertId` added to the retrieval filter contract (`@expertos/shared` `retrievalFiltersSchema` + `@expertos/ai` `RetrievalFilters`).
- `PgVectorStore.buildFilterClause` now appends, when `expertId` is set, an `EXISTS (SELECT 1 FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE dv.id = chunks.document_version_id AND (d.expert_id = $n::uuid OR d.expert_id IS NULL))` predicate (bound param; runs under the same RLS-scoped tx so tenant isolation still holds). All chunk-column predicates qualified with `chunks.` to stay unambiguous alongside the subquery.
- `ChatService.toRetrievalQuery` threads the selected `input.expertId` into the filters (omitted = neutral = full corpus).
- `ResponseCacheService.retrievalKey` now forks on `expertId` (the answer key already did) so one expert's cached chunks can't serve another's / the neutral query.
- Attribution path: `expertId` added to `IngestionInput`; `DocumentVersionRepository` sets `Document.expert_id` at creation (null = global).

**Tests:** `pgvector.store.test.ts` (+2: expert predicate present/scoped, absent for neutral); `pgvector.store.integration.test.ts` (+1 live: expertX sees own+global, expertY excluded from expertX's chunk, neutral sees all — seeds an expert-attributed doc tree); `response-cache.service.test.ts` (+expertId key-fork); `chat.service.test.ts` (+expertId flows into retrieval filters; neutral has none); `document-version.repository.test.ts` (+2: attributed vs unattributed create). Full `@expertos/api` suite 702 pass; shared 190, ai 195. Gates: api build + eslint + shared/ai lint + root knip green.

**Follow-up (not a security gap — a product feature):** the admin knowledge-upload UI does not yet let an operator *choose* the owning expert (knowledge is uploaded as global today). The boundary is enforced end-to-end and the attribution field is plumbed; surfacing an expert picker in the admin upload flow is deferred to a per-expert-knowledge-base feature. DIRECTIVES #43, LEARNINGS #27.

**Not addressed here (still open in the Security Cycle 2 verdict):** document-upload entitlement enforcement, raw-upload-object deletion, TidyCal fallback idempotency.

---

## Developer Remediation Note (2026-06-03) — Critical: Admin whitelist removal does not revoke API privilege

**Author:** implementing agent (not a review cycle). Addresses the Security Cycle 2 / Architecture Cycle 2 Critical "stale admin/expert roles can keep calling privileged APIs after whitelist removal."

**Root cause:** `RolesGuard` authorizes from `users.role`, which `AdminSessionService` only synced at portal sign-in. `AccessControlService.remove`/`updateRole` mutated `allowed_emails` but never the mirrored `users.role`, so a removed/demoted operator kept their stale role (and `is_admin` RLS) until they next re-signed-in to the portal — and could keep calling `@Roles` APIs directly with a valid Firebase token in the meantime.

**Fix (whitelist is now the API source of truth, not just a UI gate):**
- `AccessControlService.remove` now writes the matching user row back to `role = "user"`; `updateRole` mirrors the new whitelist role onto the user (demotion revokes admin immediately). Both via a new `syncUserRole` helper — case-insensitive email match, `updateMany` so it's a no-op when the invitee never signed in. Runs in the same admin-RLS transaction as the whitelist mutation + audit entry.
- `AdminSessionService.resolve` 403 path now reconciles defensively: a not-/no-longer-whitelisted email presenting a stale `admin`/`expert` role is downgraded to `user` before the 403 is thrown.

**Tests:** `access-control.service.test.ts` (+1) asserts the demote/remove write-through and that self-lockout rejections skip it; `admin-session.service.test.ts` (+1) asserts the stale-elevated reconciliation. Full `@expertos/api` suite 698 pass, changed files 100% covered. Gates: api build + eslint + jest + root knip green.

**Not addressed here (still open in the Security Cycle 2 verdict):** expert-voice knowledge boundary, document-upload entitlement enforcement, raw-upload-object deletion, TidyCal fallback idempotency.

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
