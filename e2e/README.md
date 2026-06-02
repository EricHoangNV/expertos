# ExpertOS E2E (Playwright)

End-to-end path-matrix suite (PRD §"Testing Strategy", **M11.1**) covering the consumer
web app (`apps/web`) and the admin/expert portal (`apps/admin`) against a **live stack**.

This suite is **opt-in** — it is excluded from the default `pnpm test` (it has no `test`
script, so Turbo never runs it) exactly like the live-DB integration tests in
`packages/db`. It needs real services running; it cannot boot the database or the Firebase
Auth emulator for you.

## What it covers

| Spec | Path-matrix flow |
| --- | --- |
| `web-chat.spec.ts` | signup → ask → answer → save; feedback; high-stakes disclaimer (NT.4); insufficient-knowledge next step |
| `web-voice-and-consultation.spec.ts` | multi-expert voice selection (M2.2); consultation recommendation → booking (M7.2) |
| `web-history.spec.ts` | conversation history + full-text search (M3.3); saved answers (M3.2); rename |
| `web-upload.spec.ts` | spreadsheet upload → searchable chunks (M5.3); unsupported-type rejection |
| `account-billing.spec.ts` | plan + transparent usage meter (M6.3); self-serve upgrade CTA (M6.2); _completing the Stripe-hosted checkout page: fixme (external surface)_ |
| `admin-portal.spec.ts` | role-aware portal nav; knowledge review-gate queue (M8.1); _publish→retrieval round-trip: fixme_ |
| `data-deletion.spec.ts` | admin records a deletion request (M8.4); _irreversible cascade: fixme_ |

`fixme` tests document a flow whose UI/seed prerequisite is not yet present — they keep the
matrix honest without producing flaky runs.

## Prerequisites (the live stack)

1. **Postgres + pgvector** with the schema migrated and **seeded**:
   ```bash
   pnpm --filter @expertos/db db:deploy
   pnpm --filter @expertos/db db:seed
   ```
2. **Firebase Auth emulator** on `:9099` (project `expertos-e2e`):
   ```bash
   firebase emulators:start --only auth --project expertos-e2e
   ```
3. **The three app processes**, all pointed at the emulator. Either start them yourself
   (then run with `E2E_NO_WEBSERVER=1`) or let Playwright start/attach to them via the
   `webServer` config. The API reads `FIREBASE_AUTH_EMULATOR_HOST` (+ `FIREBASE_PROJECT_ID`)
   and initializes the Admin SDK **without a service-account cert** in this mode; the
   web/admin clients read `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (see `.env.example`).

### Test identities & roles

The suite signs in as deterministic emulator accounts (`fixtures/env.ts`):
`e2e-member@`, `e2e-other@`, `e2e-expert@`, `e2e-admin@` (all `@expertos.test`). They are
created on first sign-in; **expert/admin roles must be granted out-of-band** (seed script
or `PATCH /admin/users/:id/role`) so the gated portal flows resolve.

## Running

```bash
pnpm --filter @expertos/e2e exec playwright install chromium   # one-time: browser binary
pnpm --filter @expertos/e2e test:e2e                            # headless run
pnpm --filter @expertos/e2e test:e2e:ui                         # interactive UI mode
pnpm --filter @expertos/e2e test:e2e:report                     # open last HTML report
```

### Configuration (env overrides)

| Var | Default | Meaning |
| --- | --- | --- |
| `E2E_WEB_URL` | `http://localhost:3000` | consumer web base URL |
| `E2E_ADMIN_URL` | `http://localhost:3002` | admin portal base URL |
| `E2E_API_URL` | `http://localhost:3001` | API base URL |
| `FIREBASE_AUTH_EMULATOR_HOST` | `localhost:9099` | Auth emulator host:port |
| `E2E_FIREBASE_PROJECT_ID` | `expertos-e2e` | Firebase project id |
| `E2E_NO_WEBSERVER` | _unset_ | set to `1` when you start the apps yourself |

## Notes

- Specs assert **flow-level contracts** (the turn completes, the affordance appears) rather
  than exact model output, so they are robust to whatever knowledge is seeded.
- Selectors are accessibility-first (roles/labels/placeholders) to track the rendered UI.
- Single worker, files run in order — specs share live server state.
