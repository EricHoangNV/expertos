# Learnings

Distilled insights from code reviews, security reviews, and product reviews.

---

## 1. Postgres RLS is silently bypassed by superusers and table owners

**Context:** P0.2 (tenant-ready schema + RLS migration) — verifying RLS isolation.

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` has **no effect** for a connection whose role is a superuser or the table's owner. Migrations/seeds run as the owner, so they (correctly) see everything — but if the *application* also connects with that role (e.g. the default `DATABASE_URL` superuser), every RLS policy is a no-op and tenant isolation silently does nothing. There is no error; queries just return cross-tenant rows.
- Fix: (a) `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so even the owner is subject to policies, and (b) have the app connect as a dedicated **non-superuser, non-owner** role (`app_user`, no `BYPASSRLS`) with only CRUD grants. Verified by `SET ROLE app_user` (or connecting as it): policies then enforce.
- Request context is carried in GUCs (`app.current_tenant_id`, etc.) set with `set_config(..., true)` **inside a transaction** (transaction-local); outside a transaction the setting is discarded immediately and policies see NULL → deny-by-default.

**Rule:** RLS only protects you if the application connects as a non-superuser role AND tables use FORCE ROW LEVEL SECURITY — verify enforcement by querying as that role, never as the migration/owner role.

---

## 2. Prisma's library query engine SIGILLs on this aarch64/linuxkit sandbox

**Context:** P0.2 — running the seed and RLS verification through Prisma Client.

- `new PrismaClient()` (default `engineType=library`) crashes with exit code 132 (SIGILL) on the first query in this sandbox's emulated aarch64 kernel. The **schema/migration engine is unaffected** — `prisma migrate deploy`, `prisma generate`, `prisma validate` all work; only the runtime *query* engine faults.
- Workaround for local Prisma Client runs (seed, scripts): prefix with `PRISMA_CLIENT_ENGINE_TYPE=binary` (regenerate, then run). The binary engine runs cleanly.
- **Gotcha (M3.1):** `pnpm install` runs `packages/db`'s `postinstall` (`prisma generate`) **without** that env var, so it regenerates the client bundling **only the library runtime**. After that, setting `PRISMA_CLIENT_ENGINE_TYPE=binary` at *runtime* fails fast with `Invalid client engine type, please use library or binary` (the library runtime has no binary path to switch to) — it does **not** silently fall back. Fix after any `pnpm install`: re-run `cd packages/db && PRISMA_CLIENT_ENGINE_TYPE=binary npx prisma generate` (confirm `engine=binary` in the output). The regenerated client then defaults to binary, so `pnpm test` passes via turbo even though turbo doesn't forward the env var. Symptom if skipped: `pnpm test` SIGILLs random `@expertos/api` suites — one suite instantiates `PrismaClient`, crashing the shared jest worker and taking co-located suites down with it.
- Do **not** pin `engineType = "binary"` in `schema.prisma`: production runs on amd64 Cloud Run where the library engine is correct and preferred. This is an environment quirk, not a code defect — keep the committed default.
- **Gotcha (M6.3):** `postinstall` is **not** the only library-engine regenerate. `packages/db`'s `build` and `typecheck` scripts both run `prisma generate` (no env var → library), so a mid-session `pnpm build` / `pnpm typecheck` **re-breaks** a binary-generated client. Order matters: run all `build`/`typecheck` first, then `cd packages/db && PRISMA_CLIENT_ENGINE_TYPE=binary npx prisma generate`, then run api tests **directly** (`pnpm --filter @expertos/api test` — its `test` script is just `jest`, no regenerate). A full `turbo run test` re-runs `db#build` (library) before the api suite, so it SIGILLs unless you accept that turbo serializes build-before-test; running the api filter directly after a binary generate is the reliable path. Symptom: identical code shows `317 passed` (binary) vs `8 suites SIGILL` (library) between runs.
- **Gotcha (M6.3):** after a `schema.prisma` change, `turbo run typecheck` runs `db#build` and `db#typecheck` **concurrently**, and both invoke `prisma generate` into the same `generated/client` dir → a copyfile race on the engine `.so` (`ENOENT: no such file or directory, copyfile …libquery_engine….so.node`). Work around with `pnpm exec turbo run typecheck --concurrency=1` (or warm `db#build` first). Not a code defect — concurrent generate into one output dir.
- Related: `prisma migrate dev` / `migrate dev --create-only` are interactive and abort in a non-interactive shell. Author migrations with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` → write to `prisma/migrations/<ts>_<name>/migration.sql` (+ `migration_lock.toml`) → `prisma migrate deploy`. A small additive column (e.g. M6.3's nullable `soft_limit`) is safe to hand-write as a one-line `ALTER TABLE … ADD COLUMN`.

**Rule:** When Prisma Client SIGILLs locally, run it with `PRISMA_CLIENT_ENGINE_TYPE=binary` rather than changing the committed engine type, and build migrations via `migrate diff` + `migrate deploy` in non-interactive environments. After any `build`/`typecheck`/`install` (all regenerate the library client), re-generate binary and run the api suite via the package filter; serialize `turbo` with `--concurrency=1` if a schema change triggers a concurrent-generate race.

---

## 3. Firebase client SDK must be lazily initialized in Next.js (App Router) or `next build` fails

**Context:** P0.3 (Firebase Auth wiring) — `pnpm build` failed prerendering `/` with `FirebaseError: auth/invalid-api-key`.

- `next build` statically prerenders pages **on the server**, including client components and anything imported by the root `layout.tsx`. If a module called at import-time runs `getAuth(initializeApp(config))` with empty `NEXT_PUBLIC_*` config (the normal state in CI / unconfigured dev), Firebase throws `auth/invalid-api-key` during prerender and the whole build fails — even for unrelated routes like `/_not-found`, because they share the root layout's import chain.
- Fix: never call `getAuth`/`initializeApp` at module top level. Wrap it in a lazy `getFirebaseAuth()` that initializes on first call, and only call it from **client-runtime** code paths (effects, event handlers) — never during render. React effects don't run during SSR/prerender, so the build stays credential-free. Also gate the auth subscription on an `isFirebaseConfigured` flag (`Boolean(apiKey)`) so unconfigured dev resolves to a clean signed-out state instead of crashing on mount.
- Unrelated but observed same session: a previous failed Next build can leave a corrupted `.next` cache → `SyntaxError: Unexpected end of JSON input` reading a manifest on the next build. `rm -rf apps/*/.next` and rebuild.

**Rule:** In Next.js App Router, defer all Firebase client initialization to a lazy getter invoked only from client-runtime code (effects/handlers), and guard it behind a config-present check — module-level `getAuth()` breaks `next build` prerendering.

---

## 4. Jest default worker pool OOM-SIGKILLs on the memory-constrained sandbox

**Context:** P0.5 (Observability baseline) — after adding 6 new API test suites, `pnpm --filter @expertos/api test` intermittently failed with `A jest worker process (pid=…) was terminated by another process: signal=SIGKILL, exitCode=null`. The same suites passed individually.

- Jest defaults to `maxWorkers = cores − 1`. On this ~4 GB linuxkit box, once enough heavy suites run in parallel — several pull `firebase-admin` (large) and ts-jest compiles per worker — total RSS exceeds available memory and the OS OOM-killer SIGKILLs a worker. It surfaces as a *suite-level* failure (`Test suite failed to run`) with **zero failed assertions**, so it looks like a flaky/broken test rather than a memory issue. It is load-dependent: it appears only after the suite count crosses a threshold, not from any one test.
- Fix: bound peak memory in the shared `jest.base.cjs` — `maxWorkers: 2` (cap parallelism) + `workerIdleMemoryLimit: "512MB"` (recycle a worker that grows past the limit). After this, the full run is green and faster (no thrashing). Diagnosis tip: a worker SIGKILL with no failed assertions, that disappears when the suite is run alone, is memory pressure — not a code bug; don't chase the test logic.

**Rule:** Keep `maxWorkers` + `workerIdleMemoryLimit` set in `jest.base.cjs`. A jest "worker terminated by SIGKILL / exitCode=null" with no assertion failures (and which passes when the suite runs in isolation) is an OOM from too many parallel workers — fix it with worker/memory caps, not by editing tests.

---

## 5. Direct-construction unit tests don't exercise the Nest DI container — non-`@Global` provider wiring slips through

**Context:** M1.1 (ingestion pipeline) — an adversarial code review caught a bootstrap-breaking bug that every unit test missed. `IngestionModule` provided `DocumentVersionRepository`, which injects `RlsService`. `RlsService` is exported by `AuthModule` but `AuthModule` is **not** `@Global`, and `IngestionModule` had an empty `imports: []`. At `AppModule` bootstrap Nest would throw `UnknownDependenciesException (DocumentVersionRepository → RlsService)`.

- The existing API unit tests construct services directly (`new IngestionService(fakeA, fakeB, …)`), which never builds the DI graph — so a missing module import is invisible to `pnpm test`. `typecheck`/`lint`/`knip` don't catch it either (the import is a runtime wiring fact, not a type). Only instantiating the container surfaces it.
- Fix: a module whose providers inject `X` must either `import` the module that **exports** `X`, or `X` must live in a `@Global` module. Only `DatabaseModule` (`PRISMA`) and `ObservabilityModule` (`StructuredLogger`, `UsageLogService`) are `@Global` here; `AuthModule`/`RlsService` is **not** — any consumer must `imports: [AuthModule]`.
- Verify cheaply without `@nestjs/testing` (not installed; no network): a throwaway `NestFactory.createApplicationContext(AppModule, { logger: false })` smoke with dummy `FIREBASE_*` (a real `openssl genrsa` key) + `DATABASE_URL` resolves the whole graph and `ctx.get(IngestionService)` proves the wiring — provider instantiation happens at bootstrap, before any DB query, so the library-engine SIGILL (Learning #2) doesn't bite. Same pattern P0.5 used; not committed.

**Rule:** When you add a NestJS module that injects a provider from another module, confirm the provider is reachable — `imports:` the exporting module (unless it's `@Global`). Back it with a `createApplicationContext` bootstrap smoke; never trust direct-construction unit tests to validate DI wiring.

---

## 6. Vietnamese recall silently collapses without NFC normalization (NFD combining marks shatter tokenization)

**Context:** M1.3 / Open Decision #9 (Vietnamese retrieval quality) — confirming the retrieval stack actually works on Vietnamese, not just that answers can be styled in VI.

- Vietnamese diacritics have two byte-distinct but visually identical Unicode encodings: **NFC** (precomposed — `"ệ"` is one code point) and **NFD** (decomposed — base letter `"e"` + combining marks). Combining marks carry Unicode property `Mark` (`\p{M}`), **not** `Letter` (`\p{L}`).
- The bag-of-words tokenizer (`text.toLowerCase().match(/[\p{L}\p{N}]+/gu)`) and Postgres `to_tsvector('simple', …)` both split on non-letter/number runs, so a **decomposed** word is shattered: `"Việt"`→`["vie","t"]`, `"trưởng"`→`["tru","o","ng"]`. In a real sentence only ~2 of 6 words survive intact. A query and a document stored in different normalization forms then share almost no tokens — recall silently drops toward zero in **both** the vector path (embedder) and the keyword path (`to_tsvector`). No error is thrown; results just quietly go empty.
- Clients differ in what they emit (macOS text input and some IMEs lean NFD; most web/JSON is NFC), so mixed forms across ingestion vs query are a real production condition, not a theoretical one.
- Fix: **NFC-normalize at every text boundary.** Embedder tokenizer + chunker normalize via a single shared `@expertos/ai` `tokenize`/`normalizeText`; query text is normalized at the validation boundary via a `retrievalQuerySchema.text.transform(normalizeText)` in `@expertos/shared` (the Postgres keyword path bypasses the embedder, so the schema must hand it NFC text). NFC is idempotent and length-preserving for these scripts, so normalizing after `.max()` can't smuggle the value back over the bound.
- Guarded by an offline eval-harness regression case (`vi-pricing-nfd`): an NFD-form query against an NFC corpus must return the same ranked result as its NFC twin.

**Rule:** Any text that is tokenized, embedded, or full-text indexed must be Unicode-NFC-normalized first, applied consistently to both indexed content and query text. Treat NFC normalization as part of input sanitization (directive §1). When a new embedding/tokenizer driver lands, keep NFC normalization in its tokenization path. A passing English test proves nothing about this — add a decomposed-vs-composed regression case for any diacritic-bearing language.

---

## 7. Prisma `$queryRawUnsafe`/`$executeRawUnsafe` binds string params as `text` — `uuid` columns/comparisons need an explicit `::uuid` cast

**Context:** M11.2 — building the live-DB RLS negative test suite (`packages/db/src/rls.integration.test.ts`), the first code in the repo to exercise the raw-SQL paths against real Postgres as the `app_user` role.

- A raw `INSERT INTO tenants (id, ...) VALUES ($1, $2, ...)` with a JS `randomUUID()` string for the `uuid` `id` column failed at runtime with `ERROR: operator does not exist: uuid = text` (SQLSTATE `42883`) — even though the statement contains no visible `=`.
- Root cause: Prisma's raw helpers send every JS string parameter to Postgres typed as `text` (not `unknown`), so Postgres never infers the parameter as `uuid` from the target column. In a multi-row `VALUES` / any context where the planner must unify the parameter against a `uuid`, it looks for a `uuid = text` operator, finds none, and aborts. A single-row assignment sometimes survives via an assignment cast, so the bug is intermittent and easy to miss in a quick smoke.
- Fix: cast every `uuid` parameter at the SQL boundary — `$1::uuid` for scalars, `$1::uuid[]` for `id = ANY($1::uuid[])` array predicates. With the casts, all 15 RLS isolation/WITH-CHECK tests pass as `app_user`.
- This is latent in the existing raw-SQL stores (`PgVectorStore`, conversation-search `SEARCH_SQL`, `PgExpertStore`, the semantic-cache store, the M8.3 `FailedQueryService` `LATERAL` join) — they were only ever unit-tested with a mocked `$queryRawUnsafe`. When those join the live integration pass, audit each raw statement for an un-cast `uuid`/`uuid[]` parameter (the GUC `set_config(...)` calls in `applyRlsContext` are fine — they take `text`).

**Rule:** In Prisma `$queryRawUnsafe`/`$executeRawUnsafe`, cast every `uuid` (and `uuid[]`) bind parameter explicitly (`$n::uuid`) — Prisma types string params as `text`, and Postgres will not infer the column type for you; a passing mocked-tx unit test cannot catch this, only a live-DB run will.

---

## 8. A stamped retention/expiry field with no sweeper is a silent compliance gap — verify the deleter exists

**Context:** NT.3 — backing the published data-retention policy. The M5.2 upload pipeline stamped an `expires_at` on every `temporary` upload and four code comments referenced "a sweeper reclaims them" / "a future sweeper job", but no such job had ever been built. Retrieval defensively filtered expired rows so nothing leaked, which masked the gap — but the rows accumulated forever and the policy's "auto-delete: yes" promise was aspirational.

- Writing the expiry stamp is the easy, visible half; the background deleter that acts on it is the half that silently never ships. A `lt: now` filter on the read path makes the system *behave* as if expired data is gone, so the missing enforcement is invisible in normal use and in unit tests.
- The fix is a deterministic, admin-triggered sweep (`RetentionService.preview`/`sweep`) honouring the per-row stamp (not a separate constant — `TEMPORARY_RETENTION_DAYS` was 7 while the policy DRAFT said 90; the stamp is the source of truth), run cross-tenant under the admin `is_admin` RLS bypass, with the delete + its audit entry in one transaction. No in-app cron (per "No full infra Day 1") — a route a Cloud Scheduler job targets.
- Scope discipline: only the classes with unambiguous, side-effect-free *deletion* semantics were swept (uploads, idle conversations, usage logs). The policy's concierge records ("anonymize after retention") and consultations (deleting them distorts historical MRR) need anonymize-not-delete instead — bolting them onto a deleter would implement the wrong semantics, so they were left as an explicit follow-up.

**Rule:** Whenever you see a stamped `expires_at` / `retention_days` / TTL column (or a comment promising one will be reclaimed), confirm a sweeper actually deletes on it — a read-path expiry filter hides the absence. When you build the sweep, key it off the per-row stamp (the authoritative TTL), keep the action+audit atomic, and only *delete* classes whose retention truly means deletion; "anonymize/retain-aggregate" classes need a separate non-deletion path.

---

## 9. A two-sided "emulator/local-mode" enabler must be wired on every process — client wiring alone leaves the server unable to boot

**Context:** M11.1 — auditing why the Playwright E2E stack had never actually been executed. The enabler work added env-guarded `connectAuthEmulator` wiring to the web + admin Firebase **clients**, and the Playwright `webServer` config passed `FIREBASE_AUTH_EMULATOR_HOST` to the API process — but the API's `createFirebaseApp` (Admin SDK) always required a full service-account cert (`projectId` + `clientEmail` + `privateKey`) and threw otherwise, with no emulator branch.

- Net effect: the API process boots with only `FIREBASE_AUTH_EMULATOR_HOST` set and immediately throws `Firebase credentials missing`, so `/health` never comes up and the *entire* E2E suite fails to start — before a single spec runs. The gap was invisible because no test ever booted the API against the emulator; the unit test only asserted the throw-when-missing path.
- Root cause: an emulator/local-mode toggle is inherently multi-process (each client + each server has its own SDK init). Wiring it on the clients makes the feature *look* done in a diff, but the Admin SDK has a different init contract: against the Auth emulator it reads `FIREBASE_AUTH_EMULATOR_HOST` and skips signature verification, so it needs only a `projectId` — no cert. The cert-required init is correct for prod and wrong for the emulator.
- Fix: branch `createFirebaseApp` on `FIREBASE_AUTH_EMULATOR_HOST` → `initializeApp({ projectId })` (project id from `FIREBASE_PROJECT_ID`/`GCLOUD_PROJECT`, placeholder fallback), mirroring the client env-guard; prod no-op since prod never sets that var. Also pass `FIREBASE_PROJECT_ID` to the api `webServer` so the Admin SDK validates tokens under the same project the clients mint them with.

**Rule:** When you add an emulator/sandbox/local-mode switch, wire it on *every* process that initializes the SDK — clients AND servers — and remember each may have a different init contract (the Firebase Admin SDK needs only a `projectId` against the Auth emulator, no service-account cert). A client-only diff that "looks complete" can still leave the server unable to boot; back the switch with at least one test (or a boot smoke) that exercises the server's emulator-mode init.

---

## 10. Split-origin web/admin → API needs CORS, or every browser call fails the preflight (server-side calls hide it)

**Context:** M11.1 — first real browser execution of the E2E suite. Sign-in and `GET /me` worked, but the first cross-origin browser `fetch` (chat stream `POST :3001/chat` from web `:3000`) hung forever. The API log showed `Cannot OPTIONS /chat → 404`: the CORS preflight had no handler because the API never called `app.enableCors(...)` anywhere.

- Root cause: web (`:3000`) and admin (`:3002`) are deployed as **separate origins** from the API (`:3001`) — distinct Cloud Run services in prod, distinct ports locally. Any browser cross-origin request with a non-simple header (here `Authorization`) triggers a CORS preflight `OPTIONS`; with no CORS middleware the preflight 404s and the real request never fires. The gap was invisible to unit tests and to server-to-server calls (the test's `APIRequestContext`, the seed, the emulator REST) — only a real browser surfaces it.
- Fix: `app.enableCors({ origin: CORS_ORIGINS.split(","), methods, allowedHeaders: ["Authorization","Content-Type"] })`, defaulting to the local web/admin origins (prod sets the real client URLs). Auth is a bearer ID token, not a cookie, so credentials are intentionally off and an allowlist is enough.

**Rule:** If the SPA and its API are served from different origins, the API MUST enable CORS with an origin allowlist + the headers it actually receives (`Authorization`) — and you can only catch its absence by exercising a real browser, since server-side/test HTTP clients never send a preflight.

---

## 11. Headless chromium with no system fonts renders text at zero height — every visibility assertion on bare text fails

**Context:** M11.1 — after sign-in worked, `expect(getByRole("heading", { name: "Chat" })).toBeVisible()` failed. The `<h1>` was in the DOM with the right text and `font-size:30px`, but `offsetHeight === 0` (so Playwright treats it as not visible). Padded elements (badges) still passed, which masked the problem.

- Root cause: the sandbox had **no system fonts installed** (`fc-list` empty). The app's webfont (Sora) is loaded from `fonts.googleapis.com`, which is firewall-blocked offline, and there was no fallback glyph set — so headless chromium laid out text with zero height. Bare-text elements (headings) collapse to 0px; elements with their own box (padding/border) stay visible, which is why only some assertions failed.
- Fix: install a base font package (`fonts-liberation` / `fonts-dejavu-core` + `fontconfig`). After that the heading measured 34px and became visible. This is environment setup, not app code.

**Rule:** A browser-driven (Playwright/Puppeteer) run needs three host prerequisites, not one: the browser binary, its system libraries (`playwright install-deps`), AND at least one system font. Zero-height/invisible bare text in headless CI with passing padded elements is the signature of missing fonts, not a CSS bug.

---

## 12. A design-system `<Field label>` that renders the `<label>` without `htmlFor` is a silent a11y gap (and breaks `getByLabel`)

**Context:** M11.1 — the admin knowledge spec's `getByLabel("Status").selectOption(...)` timed out. The `<Field label="Status">` rendered `<label>Status</label>` followed by a sibling `<Select>` with no `id`, so the label was associated with nothing — `getByLabel` (and assistive tech) couldn't resolve the control. Other Field usages (chat) passed only because they happened to set `htmlFor`+`id`.

- Root cause: the DS `Field` component renders `<label htmlFor={htmlFor}>` and the control as separate children (no implicit wrapping), so the association is **opt-in** per call site. Omitting `htmlFor`/`id` looks fine visually and passes design review, but leaves the control programmatically unlabeled. The accessibility-first E2E selector is what surfaced it.
- Fix: pass matching `htmlFor`/`id` (`<Field label="Status" htmlFor="status-filter"><Select id="status-filter">`). Selecting by option **value** (not the humanized label) is also more robust for `selectOption`, since `statusLabel()` lowercases the enum.

**Rule:** Whenever a form control uses the DS `Field` (or any label-renders-separately component), pass `htmlFor` + a matching control `id` — an unassociated label is an invisible a11y defect that visual review won't catch but accessibility-first tests (and screen readers) will.

---

## 13. App-level CSS/JSX must avoid raw `px` and hardcoded hex — bespoke sizes use rem (root = 15px), brand logos need a scoped disable

**Context:** M12.1.1 — the M12.8.1 login pages were committed with a red lint gate that went unnoticed (`pnpm lint` is `turbo run lint && pnpm lint:css`, and turbo's arm64 binary SIGILLs in this sandbox — see #2's sibling — so the per-workspace eslint step never actually ran; only `lint:css` did). Two distinct guard violations had slipped in:

- `apps/web/app/login.css` used raw `px` for every dimension. The stylelint `unit-disallowed-list: ["px"]` (and `media-feature-range-notation`) is enabled for all app CSS — only `**/ds.css` is exempt (it *defines* the token scale). ds.css sets `html { font-size: 15px }`, so **`1rem = 15px`**: converting bespoke `Npx → (N/15)rem` is pixel-faithful *and* lint-clean *and* a11y-scalable; spacing that lands on the 4px grid uses `var(--sN)` tokens; media breakpoints use rem (`@media (width < 60rem)` = 900px) in range notation. Reuse a DS component class (`.btn .btn-ghost`) instead of re-declaring `border:1px`/padding/font, but keep a bespoke padding override when the component's default height would drop the control under the 44px hit target.
- The Google "G" `<svg>` in `page.tsx` and `AdminFrame.tsx` tripped the eslint `no-restricted-syntax` hardcoded-hex guard. Google's brand colors are *mandated* and can't be theme tokens — wrap the icon in `/* eslint-disable no-restricted-syntax -- third-party brand logo */ … /* eslint-enable */` with a justification.

- Caveat (CLOSED in M13.7.5): the `lint:css` glob *was* `apps/**/app/**/*.css`, so `apps/admin/src/components/admin-login.css` (under `src/`, not `app/`) escaped CSS linting entirely and kept raw `px` for two milestones. A guard that exists but doesn't glob the file is worse than no guard — it reads green. Fixed by broadening the glob to also cover `apps/**/src/**/*.css` *and* converting admin-login.css px→rem in the same commit; an inline `style={{ gap: "12px" }}` on the Google button (caught by *neither* stylelint nor eslint — inline TSX styles are outside both guards' reach) moved to a `.admin-login-google` class. Inline `px` in JSX `style={{}}` is the remaining blind spot — prefer a CSS class over an inline style for any sized property.

**Rule:** New M12/M13 UI must pass the design-system guards: app CSS expresses size as ds.css spacing tokens or rem (never raw `px`; root is 15px so rem is pixel-faithful), and the only hardcoded hex permitted in JSX is a third-party brand asset behind a scoped, commented eslint-disable. When `pnpm lint` looks green, confirm `turbo run lint` actually ran (it SIGILLs here) — otherwise run each workspace's `next lint`/`eslint` directly.

---

## 14. A multi-line `Edit` on this OWC-Express volume can silently truncate the file tail — verify integrity with `git diff`, not just the edit's success message

**Context:** M13.6 — inserting a ~40-line block into `packages/ui/src/ds.css` near line 447 (via the `Edit` tool) reported success, but the **end of the file** (the last ~30 lines: the M12.7.2–4 `.tweaks-*` styles + the `prefers-reduced-motion` block) was silently truncated, leaving a dangling half-line `.tweaks-section > .s`. The insert itself landed correctly; the loss was at the far end, far from the edited region. Caught only because `pnpm lint:css` then failed with a `CssSyntaxError` on the broken trailing line.

- Root cause: an apparent write/flush glitch on the external `/Volumes/OWC-Express-1M2` filesystem — the edited content was written but the file was not fully reconstituted, dropping the tail. The `Edit` tool's "file updated successfully" message does **not** guarantee the untouched remainder survived.
- Fix: diff against HEAD (`git diff <file>` showed an unexpected second hunk `@@ -1010,32 +1051,4 @@` deleting the tail) and restored the lost lines from `git show HEAD:<file>`. Confirmed the final diff contained **only** the intended insert (no spurious deletions) and the line count matched `HEAD + inserted`.

**Rule:** After a large multi-line `Edit`/`Write` on the `/Volumes/OWC-Express-1M2` volume, verify the whole file (lint or `git diff`), not just the tool's success message — the untouched tail can be silently dropped.

---

## 15. A Prisma-generated migration diff always wants to DROP the raw-SQL pgvector indexes — strip those before applying

**Context:** M14 — adding the `allowed_emails` table. Generating the migration with `prisma migrate dev --create-only` (which, contra #2/item 29, ran non-interactively and *correctly* against a live throwaway DB — it only prompts when it would reset) produced the right `CREATE TABLE`, but **also** four spurious `DROP INDEX "…_embedding_idx"` statements for `chunks` / `semantic_cache` / `upload_chunks` / `voice_examples`.

- Root cause: those `ivfflat`/`hnsw` vector indexes are created in a hand-written raw-SQL migration (`20260531212901_rls_and_vector_index`) and are **not modeled in `schema.prisma`** (Prisma has no native pgvector index type). So every `prisma migrate diff` sees them as drift — "an index in the DB that the schema doesn't declare" — and emits a `DROP INDEX` to "reconcile". Applying that would silently drop the vector indexes → retrieval degrades to a full scan.
- Fix: delete the `DROP INDEX` lines from the generated migration, keep only the intended `CREATE TABLE`/RLS/grant, then apply with `prisma migrate deploy` (not `migrate dev`, which would re-diff and reintroduce the drift). Validated against a live DB that all four `*_embedding_idx` survived.
- Same applies to the RLS policies/`FORCE ROW LEVEL SECURITY` and the `app` GUC helper functions — also raw-SQL-only, so a new tenant-scoped table needs its `ENABLE/FORCE RLS` + `tenant_isolation` policy + `GRANT … TO app_user` appended to the generated migration by hand (mirror the `tenant_only` family in the RLS migration).

**Rule:** Never apply a Prisma-generated migration verbatim in this repo — review it and strip any `DROP INDEX *_embedding_idx` (and re-add RLS/grant for new tables), because the pgvector indexes and RLS live in raw SQL the schema doesn't model.

**Rule:** After a large/multi-line `Edit` or `Write` on a long file in this repo, don't trust the success message alone — run `git diff <file>` and confirm the only changes are the ones you intended (no deletions far from your edit) and that `wc -l` ≈ expected. The lint/test gates are the safety net that catches a silent truncation; never skip them after a big edit.

---

## 16. The knowledge state machine tracks status on two rows (version + document); a transition that updates only the version leaves the board stuck

**Context:** M13.3 (knowledge kanban) — submitting a draft for review left its card in the Draft column.

- The publish state machine in `KnowledgeService` mutates `documentVersion.status` on every transition, but the kanban board (and the `/admin/analytics/knowledge-pipeline` rollup) list and **count** by `document.status`, the parent row. `approve` and `archive` already updated `document.status` in lockstep, but the shared `transition()` helper (used by `submit` draft→expert_review and `requestChanges` expert_review→draft) only touched the version — so a submitted draft's `document.status` stayed `draft` and the card never moved columns even though the version had advanced.
- Fix: `transition()` now also `tx.document.update({ data: { status: spec.to } })`, matching `approve`/`archive`. Safe for retrieval because retrieval visibility is gated on `chunk.status` (the `chunk_status` enum) and `document.publishedVersionId`, **not** `document.status` — so moving an already-published document's `document.status` to `expert_review` on a re-submit does not hide its live chunks.
- `document.status` is therefore a denormalized "where is the latest work" pointer for the board/analytics, distinct from the per-version lifecycle. Any new transition must keep it in sync.

**Rule:** When a state machine denormalizes the same status onto a parent row that the UI/analytics read from, every transition path (not just the create/publish ones) must update both rows — and confirm which row the read paths (retrieval vs. board) actually key off before assuming a parent-status change is harmless.

---

## 17. `Intl.NumberFormat` currency output uses a no-break space — exact `.toBe()` assertions with a normal space fail invisibly

**Context:** M13.5 (locale-aware formatting) — a test asserting `formatCurrency("vi", 4.99, "USD")` equalled `"4,99 US$"` failed with `Expected: "4,99 US$"` / `Received: "4,99 US$"` — visually identical.

- `Intl.NumberFormat(..., { style: "currency" })` separates the amount from the symbol with a **no-break space** — U+00A0 (or the narrow no-break U+202F in some locales/ICU builds), not an ASCII U+0020. A test literal typed with a regular space therefore never `.toBe()`-matches the formatter output, and the jest diff prints both sides looking the same because the terminal renders all three space code points identically.
- The same applies to `toLocaleString`/`Intl.DateTimeFormat` outputs that contain spaces. The exact code point can also shift between Node/ICU versions, so hardcoding the no-break char in the expected string is brittle.
- Fix: normalize whitespace before comparing — `s.replace(/\s/g, " ")`. JS `\s` matches both U+00A0 and U+202F (and other Unicode spaces), so this collapses any separator the formatter chose to a plain space. Alternatively assert with `.toContain()` on the digits + symbol substrings.

**Rule:** Never assert `Intl.*`-formatted strings against a literal containing spaces with `.toBe()` — the separator is a no-break space (U+00A0/U+202F). Normalize with `.replace(/\s/g, " ")` (or use substring assertions) so the test is stable across whitespace variants and ICU versions.
