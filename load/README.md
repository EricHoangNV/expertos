# ExpertOS load smoke (M11.3)

A small, threshold-gated load driver for the API (PRD §"Testing Strategy"). It drives sustained
concurrent traffic at a **live stack** and fails (exit 1) if a scenario blows its latency budget or
error ceiling — so it can gate a deploy.

Like `infra/`, this is **not** a pnpm workspace and has **no dependencies**: `smoke.mjs` uses only
the Node runtime's global `fetch` + `node:perf_hooks`. It therefore stays out of the default
`pnpm test` / `typecheck` / `lint` / `knip` gates, exactly like the opt-in Playwright `e2e/` suite —
it needs real services running and cannot boot them for you.

## Run

```bash
# Health-only — no auth, just proves the process survives concurrent load.
node load/smoke.mjs

# Add the authed scenarios (entitlements read + cache-warming chat).
LOAD_TOKEN="<firebase-id-token>" node load/smoke.mjs

# Print this instance's cache hit rates after the run (M11.3 tuning signal).
LOAD_TOKEN="<member-token>" LOAD_ADMIN_TOKEN="<admin-token>" node load/smoke.mjs
```

Get an ID token from the running Firebase Auth emulator the same way the `e2e/` fixtures do
(`getEmulatorIdToken`), or from a real sign-in. The `chat` and `entitlements` legs are **skipped**
(not failed) when `LOAD_TOKEN` is unset.

## Scenarios

| Scenario | Auth | What it exercises |
| --- | --- | --- |
| `health` | no | `GET /health` — the cheap liveness path; baseline that the server takes load |
| `entitlements` | yes | `GET /me/entitlements` — a representative authed DB read (token-verify + RLS) |
| `chat` | yes | `POST /chat` — the RAG hot path; **repeats one fixed question** so the M6.4 answer cache warms (cold first turn → hot thereafter) |

Run a single leg with `LOAD_SCENARIO=chat`.

## Tuning knobs (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `LOAD_BASE_URL` | `http://localhost:3001` | API base URL (Cloud Run injects `PORT`; local dev falls back to 3001) |
| `LOAD_CONCURRENCY` | `20` | In-flight requests per scenario phase |
| `LOAD_DURATION_SEC` | `15` | Duration of each scenario phase |
| `LOAD_REQUEST_TIMEOUT_SEC` | `30` | Per-request hard timeout (a hung socket can't stall a phase) |
| `LOAD_P95_MS` | `1500` | p95 latency budget; a phase over it fails |
| `LOAD_MAX_ERROR_RATE` | `0.01` | Error-rate ceiling (non-2xx / network / timeout); a phase over it fails |
| `LOAD_SCENARIO` | _(all)_ | Run only this named scenario |
| `LOAD_QUESTION` | `How do I file my taxes?` | The fixed `chat` question (keep it constant so the cache warms) |
| `LOAD_EXPERT_ID` | _(none)_ | Optional voice for the `chat` leg; omit for the neutral voice |
| `LOAD_TOKEN` | _(none)_ | Bearer ID token for the authed scenarios |
| `LOAD_ADMIN_TOKEN` | _(none)_ | Admin bearer; when set, prints `GET /admin/analytics/cache` after the run |

## Reading the cache signal

`GET /admin/analytics/cache` reports cumulative, **per-instance** hit rates for the three M6.4 layers
(retrieval / answer-memory / persistent-semantic). It's the observability the caching tuning turns
on: drive the `chat` leg with a repeated question, watch `answer` climb toward the cold-miss floor
(one cold turn out of N), and size `apps/api/src/cache/cache.config.ts` (`maxEntries` / `ttlMs`) from
the `evictions` / `expirations` counters. Because the cache is in-process, the numbers reflect only
the instance that served the request — run the smoke against a single instance for a clean read.

## Prerequisites (the live stack)

The same stack the `e2e/` suite documents: Postgres + pgvector (migrated **and seeded**, so `chat`
has knowledge to retrieve), the API process, and — for tokens — the Firebase Auth emulator. The
health-only run needs just the API process.
