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

### Product Review: Cycle 0 — (no review yet)
- (awaiting first product review)

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
