# Feedbacks

## Latest Review Verdicts (read this section first — stop at the breaker line)

### Security: Cycle 1 — PASS (2026-06-01)
- auth & access control: PASS (every new admin route `@Roles("admin")`, expert routes `@Roles("expert")`, only webhook is `@Public()`/HMAC; elevated-but-bounded RLS reads re-bound by explicit tenant_id+expert_id)
- data exposure / secrets: PASS (no cross-tenant leak; `invalidateTenant` pins tenantId under admin GUC; no secrets logged)
- input validation: PASS (all raw `$queryRawUnsafe` use constant SQL + bound `$n` params; zod schemas on bodies/queries; webhook HMAC over raw body w/ constant-time compare)
- dependency / supply chain: PASS (no new untrusted deps; lockfile additive)
- Severity: none — no HIGH/MEDIUM findings (M11.2 `/cso` audit, full branch diff vs main)

### Code Review: Cycle 0 — (no review yet)
- (awaiting first code review)

### Product Review: Cycle 1 — FAIL (2026-06-03)
- requirements coverage: FAIL (uncited real-LLM answers can bypass insufficient-knowledge handling, review, and escalation)
- core user flow: FAIL
- data handling / privacy: PASS
- High: citationless answers can still be delivered as ordinary expert answers without the honest limitation state

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
