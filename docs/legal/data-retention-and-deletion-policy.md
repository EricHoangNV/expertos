# Data Retention & Deletion Policy — DRAFT

> **Status: DRAFT awaiting PM approval (NT.3 human gate).**
> The technical enforcement described here is already built and tested (`RetentionService`,
> `apps/api/src/admin/retention.service.ts`; windows in `retention.config.ts`). This document is the
> *published* policy that the enforcement honours. Approving and publishing it closes NT.3 / M11.4.
>
> Two columns matter for review:
> - **User-facing text** (the left/main prose) — what we publish to users.
> - **Enforcement note** (the indented blockquotes) — how the code already implements each clause, for
>   the reviewer's confidence. These notes are *not* part of the published text; strip them on publish.

---

## 1. Summary

We keep your data only as long as we need it to provide the service, meet legal and tax obligations,
and improve answer quality. When a retention window passes, data is automatically deleted or
anonymized. You can also ask us to delete your account and all associated data at any time.

## 2. What we keep, and for how long

| Data | What it is | Retention | What happens at the end |
|---|---|---|---|
| **Temporary uploads** | Files you attach to a single conversation for context (not added to a knowledge base) | **7 days** from upload | Permanently deleted, including all extracted content |
| **Saved (persistent) uploads** | Files you explicitly save to your private workspace | Until you delete them | Kept until you remove them or delete your account |
| **Conversation history** | Your questions, AI answers, and citations | **2 years** from last activity in that conversation | Permanently deleted |
| **Usage records** | Per-question metadata (timestamps, token/cost counts, plan) used for billing, fair-use limits, and product analytics | **2 years** | Permanently deleted |
| **Consultation transcripts** | Free-text notes from an expert consultation you booked | **1 year** from the consultation date | Notes permanently deleted; the booking record (date, that it occurred) is kept for tax/financial records |
| **Concierge review records** | Internal records of expert review/editing of AI answers | **1 year** | **Anonymized** — answer text and reviewer notes are scrubbed; an anonymous structural record is kept for aggregate quality analytics |
| **Account & billing records** | Identity, subscription, and payment history | While your account is active; payment records retained as required by law | See §4 (account deletion) |

> **Enforcement note.**
> - Temporary uploads: each row is stamped with `expiresAt = now + 7 days` at upload time
>   (`TEMPORARY_RETENTION_DAYS = 7`, `upload.service.ts`). The sweep honours the per-row stamp, so the
>   TTL stays a single source of truth even if it later varies by plan. Persistent uploads carry
>   `expiresAt = null` and are never swept.
> - Conversation history: purged when `updatedAt` is older than `RETENTION_CONVERSATION_DAYS` (default
>   **730**). Deleting a conversation cascades to its messages, citations, feedback, and saved answers
>   (`ON DELETE CASCADE`).
> - Usage logs: purged when `occurredAt` is older than `RETENTION_USAGE_LOG_DAYS` (default **730**).
> - Consultation transcripts: `consultation_notes` deleted when the parent consultation's date
>   (`scheduledAt ?? createdAt`) is older than `RETENTION_CONSULTATION_TRANSCRIPT_DAYS` (default
>   **365**). The parent `consultations` row (revenue/MRR) is deliberately **kept**.
> - Concierge records: `review_responses` older than `RETENTION_CONCIERGE_DAYS` (default **365**) have
>   `originalAnswer`/`revisedAnswer`/`notes` scrubbed to `[redacted]`/null in place. Idempotent — a
>   re-run never re-touches a scrubbed row. The structural row survives for M10.3 analytics.

## 3. How automatic deletion works

Deletion is not manual. A retention sweep runs on a schedule and removes or anonymizes everything past
its window in a single audited operation. Every sweep records what it purged.

> **Enforcement note.** The sweep is an admin-guarded endpoint (`POST /admin/retention/sweep`),
> intended to be driven by a scheduled job (e.g. Cloud Scheduler) per the "no full infra Day 1"
> constraint — there is no in-app cron. `GET /admin/retention/preview` is a non-destructive dry run
> that reports the blast radius first. Each sweep appends one immutable audit entry **in the same
> transaction** as the deletes, so the record of what was purged is atomic with the purge itself.
>
> **PM decision needed:** confirm the sweep cadence (recommended: daily) and who owns the scheduled
> job. The policy text above does not name a cadence, which is fine to publish as-is.

## 4. Deleting your account

You may request deletion of your account at any time. When a deletion is executed, we **permanently
and irreversibly** delete your account and all data owned by it — conversations, uploads, saved
answers, usage records, and fair-use flags — except records we are legally required to retain (e.g.
payment/tax records, which are retained for the statutory period and then deleted).

> **Enforcement note.** Two-step, GDPR-aligned (M8.4): a deletion *request* is recorded
> (`dataDeletionRequest`, status `requested`), then `executeDeletion` hard-deletes the `users` row and
> Postgres `ON DELETE CASCADE` removes everything owned by it. The audit entry is written **before**
> the delete so durable proof of the deletion survives the cascade. An expert profile linked to the
> user is detached (its `user_id` is cleared) rather than destroyed.
>
> **PM decisions needed before publish:**
> 1. **Self-serve vs. admin-mediated deletion.** Today deletion is executed by an admin. If the
>    published policy promises self-serve "delete my account," we need a user-facing trigger (small
>    scope) — otherwise the text should say "contact us / use the in-app request and we delete within
>    N days."
> 2. **Promised turnaround.** State the SLA (recommended: "within 30 days of request").
> 3. **Statutory payment-record retention period** — confirm the exact number with finance/legal and
>    insert it where this section says "the statutory period."

## 5. Data we never use for training

(Confirm and include if true.) Your conversations and uploads are not used to train third-party
foundation models. Expert knowledge bases are used only to answer questions within this product.

> **PM/legal decision needed:** confirm this statement is accurate against current LLM-provider
> contracts (OpenAI/Anthropic/Gemini) and our own usage, then keep or remove §5.

## 6. Open items for the approver (checklist)

- [ ] Confirm the four retention windows (7d / 2yr / 2yr / 1yr / 1yr) are the values we want to publish.
- [ ] Decide self-serve vs. admin-mediated account deletion, and the promised turnaround SLA.
- [ ] Insert the statutory payment-record retention period (§4).
- [ ] Confirm or remove the "not used for training" statement (§5).
- [ ] Confirm the sweep cadence and the owner of the scheduled job (§3).
- [ ] Approve final user-facing wording and publish (strip the "Enforcement note" blockquotes).

---

*When approved, the published version (notes stripped) should live at the product's `/legal/privacy`
or `/legal/data-retention` URL and be linked from the account/settings page. Mark NT.3 `[x]` and
M11.4 progress accordingly.*
