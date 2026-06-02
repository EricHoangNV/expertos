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
| `admin-portal.spec.ts` | role-aware M13.1 nav (OPERATE / MONETIZE / EXPERT PORTAL + role badge); knowledge-approval kanban + step filter (M8.1/M13.3); _publish→retrieval round-trip: fixme_ |
| `data-deletion.spec.ts` | admin records a deletion request (M8.4); _irreversible cascade: fixme_ |
| `admin-i18n.spec.ts` | admin portal EN→VI locale toggle: nav, role badge, page headers switch + persist (M13.3, M15.3.1) |
| `access-control.spec.ts` | admin whitelist add / re-role / remove (M14); Access Denied for a non-whitelisted email (M15.3.2) |
| `web-i18n.spec.ts` | consumer EN→VI language toggle: chat, account, history switch + persist (M13.1–.5, M15.3.6) |

`fixme` tests document a flow whose UI/seed prerequisite is not yet present — they keep the
matrix honest without producing flaky runs. The current matrix is **20 passed / 3 fixme-skipped**.

> **Note on the stack env:** the admin portal is gated by the M14 access-control whitelist, so
> `global-setup.ts` seeds `e2e-admin@`/`e2e-expert@` into `allowed_emails` (and resets every test
> identity's profile locale to English, since the i18n specs persist a VI choice). The per-IP rate
> limiter (M11.2) is relaxed for the run via `RATE_LIMIT_MAX` (the managed `webServer` sets it) —
> every request shares one loopback IP, so the default 300/60s trips under a full-suite burst.

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

### Test identities, roles & sign-in

The suite uses deterministic emulator accounts (`fixtures/env.ts`): `e2e-member@`,
`e2e-other@`, `e2e-expert@`, `e2e-admin@` (all `@expertos.test`).

`global-setup.ts` (wired via `globalSetup` in the Playwright config) prepares them once
before the run, so the suite is repeatable against a freshly-seeded stack:

1. signs each identity into the emulator and hits `GET /me`, so the API mirrors a local user
   row (it keys on `firebase_uid`, assigned by the emulator — roles can only be promoted
   *after* the row exists, not pre-seeded by email);
2. promotes `e2e-admin@` → `admin` and `e2e-expert@` → `expert` directly in the DB (there is
   no pre-existing admin to authorize the role-change API — the bootstrap problem), reading
   `DATABASE_URL` (the same URL the API uses); and
3. puts `e2e-member@` on the **Plus** plan so the question/upload flows don't hit the Free
   plan's monthly hard cap across repeated runs (Plus is not the top tier, so the self-serve
   upgrade CTA still renders).

**Sign-in is programmatic, not the Google popup.** `signInWithPopup` loads `apis.google.com`
for its OAuth handler, which is unreachable from a sandbox/CI. Each app's `lib/firebase.ts`
therefore exposes an emulator-gated `window.__e2eSignIn` (email/password against the emulator,
on the app's own Auth instance) that the fixtures drive — no popup, no external network. The
helper is gated on `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (never set in production).

## Running

```bash
# One-time: the chromium binary, its Linux system libraries, AND base fonts. Without fonts,
# headless chromium renders text at zero height (webfonts are blocked offline) so visibility
# assertions on bare-text headings fail — install a font package such as fonts-liberation.
pnpm --filter @expertos/e2e exec playwright install chromium
sudo pnpm --filter @expertos/e2e exec playwright install-deps   # or: sudo apt-get install <libs>
sudo apt-get install -y fonts-liberation                        # base glyphs for headless render

pnpm --filter @expertos/e2e test:e2e                            # headless run
pnpm --filter @expertos/e2e test:e2e:ui                         # interactive UI mode
pnpm --filter @expertos/e2e test:e2e:report                     # open last HTML report
```

`global-setup.ts` reads `DATABASE_URL` for the role/plan promotion, so export it (the same
app_user URL the API uses) when running with `E2E_NO_WEBSERVER=1`.

### Configuration (env overrides)

| Var | Default | Meaning |
| --- | --- | --- |
| `E2E_WEB_URL` | `http://localhost:3000` | consumer web base URL |
| `E2E_ADMIN_URL` | `http://localhost:3002` | admin portal base URL |
| `E2E_API_URL` | `http://localhost:3001` | API base URL |
| `FIREBASE_AUTH_EMULATOR_HOST` | `localhost:9099` | Auth emulator host:port |
| `E2E_FIREBASE_PROJECT_ID` | `expertos-e2e` | Firebase project id |
| `E2E_NO_WEBSERVER` | _unset_ | set to `1` when you start the apps yourself |
| `DATABASE_URL` | _unset_ | read by `global-setup.ts` to promote roles + the member's plan |

> The API must allow the web/admin origins via CORS (`CORS_ORIGINS`, default
> `http://localhost:3000,http://localhost:3002`) — the browser sends a cross-origin preflight
> to `:3001`. The defaults cover the local stack.

## Notes

- Specs assert **flow-level contracts** (the turn completes, the affordance appears) rather
  than exact model output, so they are robust to whatever knowledge is seeded.
- Selectors are accessibility-first (roles/labels/placeholders) to track the rendered UI.
- Single worker, files run in order — specs share live server state.
