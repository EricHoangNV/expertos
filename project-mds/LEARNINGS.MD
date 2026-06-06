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

---

## 18. A custom jest `roots` silently disables node-module manual mocks in `<rootDir>/__mocks__`

**Context:** M15.1.1 (web jest harness) — `firebase/auth` manual mock in `apps/web/__mocks__/firebase/auth.ts` was being ignored, so the real Firebase SDK ran and `useAuth` always reported signed-out despite `setMockUser(...)`.

- Jest auto-applies manual mocks for **node modules** (`__mocks__/<pkg>.ts`, adjacent to `node_modules`) only when that `__mocks__` directory sits at the root of one of the configured `roots`. Setting `roots: ["<rootDir>/app", "<rootDir>/src", ...]` to scope the test search moved the expected location to `app/__mocks__`, `src/__mocks__`, etc. — so `<rootDir>/__mocks__` was never consulted. There is **no warning**: the mock is just skipped and the real module loads.
- Fix: leave `roots` at the default (`<rootDir>`) and scope where tests are found with `testMatch` (`"<rootDir>/(app|src|test)/**/*.test.{ts,tsx}"`) + `testPathIgnorePatterns` (`/node_modules/`, `/.next/`) instead. User-module manual mocks (`src/lib/__mocks__/foo.ts`) still require an explicit `jest.mock("./foo")`; only node-module mocks are automatic.
- Two adjacent harness gotchas from the same task: (a) test-only deps used **only** in jest-ignored files (`@testing-library/react` etc., since knip's `ignore` drops `**/*.test.tsx`) must go in knip's `ignoreDependencies` like `ts-jest`/`@types/jest` — but do **not** add ones knip already resolves via its jest plugin (`jest-environment-jsdom`), or knip fails with "Unused item in ignoreDependencies". (b) A render helper that pre-seeds `localStorage` for a deterministic locale sets the LocaleProvider's `hasLocalPref` flag, which **suppresses** the `GET /me` profile-seed path — seed localStorage only when a test explicitly pins the locale, else let the profile response drive it.

**Rule:** Don't narrow jest `roots` to subdirectories if you rely on `<rootDir>/__mocks__` node-module manual mocks — scope with `testMatch`/`testPathIgnorePatterns` instead. Test-only deps confined to knip-ignored files belong in `ignoreDependencies` (but not ones the jest plugin already sees).

---

## 19. Admin/web data pages double-load on mount — assert through `waitFor`, never a sync `getBy*` after a single `findBy*`

**Context:** M15.2.3 (admin dashboard jest tests) — assertions intermittently failed with "found `$15,999` then couldn't find `MRR`" across runs; the same `getBy*` passed or failed depending on timing.

- The auth context memoizes its value (incl. `getIdToken`) on `[user, role, denied, loading]`. `AdminFrame` renders the page as soon as `loading===false && user && !denied` — **before** the `POST /me/admin-session` call resolves the role. So the page mounts with `getIdToken`-v1, fires its `load()` effect, then when the session resolves `role` flips → the memo recreates `getIdToken` (new identity) → the page's `load` `useCallback` changes → its effect re-runs. Each `load()` starts with a synchronous `setData(null)`, so there's a brief window where the just-rendered data is wiped and re-fetched.
- A test that does `await screen.findByText(A)` (async, retries) immediately followed by `screen.getByText(B)` (sync, one-shot) is racy: `findByText(A)` resolves against the first load's data, then the second load's `setData(null)` lands before the sync `getByText(B)` runs → "element not found". The flake set shifts run-to-run.
- Fix: wrap **all** positive, data-dependent assertions for a page like this in a single `await waitFor(() => { … })` block — `waitFor` retries the whole callback until it passes against the settled state, sailing past the transient clear. Don't leave a trailing sync `getByRole`/`getByText` after the `waitFor`; fold it in. Negative assertions (`queryBy… not present`) are safe outside because a clear can't make them false-fail.

**Rule:** For React pages whose data can transiently clear (an effect re-fires because a context value identity churns), assert via `waitFor`/`findBy*` end-to-end — never a synchronous `getBy*`/container-query immediately after an awaited `findBy*`. This applies to every M15.2.x admin page test (and the web page tests) since they all mount inside the same auth-gate double-load.

---

## 20. Staged-edit jest tests must gate on load *quiescence*, not a fixed load count — admin data pages re-load 3× on mount

**Context:** M15.2.5 (admin entitlement-matrix / access-control / users CRUD tests) — the matrix toggle tests flaked ~30% of runs with "no row for Saved answers" / a wiped "Unsaved" badge, even after wrapping reads in `waitFor` (learning #19).

- Learning #19 said these pages "double-load." In the jest harness they actually load **three** times: `renderWithProviders` sets the mock `currentUser` *before* mount, and the auth context's `getIdToken` reads `getFirebaseAuth().currentUser` (the mock getter) — so the page's very first `load()` effect already has a token and fires a real fetch on **mount** (v1), then again when `onAuthStateChanged` sets `user` (v2), then again when `POST /me/admin-session` resolves `role` (v3). The v3 load is gated behind an async fetch, so it can fire *after* a `waitFor` that only required "content present + 2 loads" has already passed.
- For a read-only page that's harmless (learning #19's `waitFor` covers it). But for a **staged-edit** page (the entitlement matrix stages cell edits in local `drafts`), every `load()` calls `seedDrafts()`, which **overwrites the staged edit**. A test that toggled a cell after a too-early settle gate had its edit wiped by the trailing v3 re-seed → the "Unsaved" badge and "Publish 1 change" button vanished.
- Fixes that did **not** work: counting loads (`calls >= 2`) — fragile magic number, and v3 can still land later; re-querying the element in `waitFor` right before the click — the wipe happens *after* the click. The robust fix is to gate interactions on **quiescence**: `waitFor` until the page's load count has been *stable across two consecutive polls* (≈100ms with no new load) while the anchor content is present. After quiescence no further re-seed fires, so a staged edit survives and a synchronous element query + `fireEvent` is safe.

**Rule:** When a jest test stages local edits on an admin/web data page and then acts on them, don't interact until the page has gone *quiet*. Poll the relevant fetch count and require it unchanged for ≥2 consecutive `waitFor` ticks (plus the anchor row rendered) before the first `fireEvent` — a fixed load-count gate is unreliable because the mock-`currentUser`-before-render fan-out issues one extra mount-time load and the role-resolution load can arrive late.

---

## 21. A namespaced translator returns its FULL dotted path on a miss — a fallback that compares against the un-prefixed sub-key never fires

**Context:** M15.2.7 (admin i18n tests) — writing the `useStatusLabel` "unknown token → humanized form" test failed, revealing the shipped hook never actually humanized; an unknown lifecycle status rendered the raw `common.status.<token>` token in the admin UI.

- `createTranslator(messages, "common")` (in `@expertos/ui`) prepends the namespace before looking up, and on a miss `translate` returns the *whole* key it looked up — i.e. `"common.status.foo"`, not the `"status.foo"` the caller passed.
- `useStatusLabel` built `const key = ` status.${status} ``, called `t(key)`, then did `label === key ? humanize : label`. Because the miss-return carries the `common.` prefix, `label` (`"common.status.foo"`) never equaled `key` (`"status.foo"`), so the humanize branch was dead code and the raw namespaced token leaked to the UI for any status outside the 43-token catalog.
- Fix: compare against the prefixed form the translator actually returns — `label === ` common.${key} `` → then `status.replace(/_/g, " ")`. Known tokens (real labels) still take the `: label` branch unchanged.

**Rule:** When detecting a translation miss to drive a fallback, compare the translator's return against the **fully-namespaced** key it resolves internally (`namespace.sub.key`), not the bare sub-key you passed to a namespaced `t()` — otherwise the equality check never matches and the fallback silently never runs.

---

## 22. Running the live E2E (Playwright) stack in this sandbox: `next dev` works, but the external volume corrupts dev chunks, and the suite bit-rots against UI overhauls

**Context:** M15.3 — standing up the full live stack (DB + Firebase Auth emulator + API + web + admin) to actually *run* the Playwright suite, which prior agents had only written/partly run.

- **The stack is runnable here** (contradicting the "not runnable in CI/sandbox" notes): Docker (pgvector image cached), `firebase-tools` (downloads the auth emulator jar over the network), Java, and the Playwright chromium + `fonts-liberation` are all present. Bring it up with `infra/local-test-db.sh up` (DB:5432), `firebase emulators:start --only auth --project expertos-e2e` (:9099), then start the three services **yourself** and run with `E2E_NO_WEBSERVER=1`. `next build`/`next start` still SIGILL/arch-fail, but **`next dev` works** — and the NestJS API runs via `npx nest start` (ts, no build). The API needs `DATABASE_URL` (app_user), `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`; web/admin need the `NEXT_PUBLIC_FIREBASE_*` + `NEXT_PUBLIC_API_URL`. Pass `DATABASE_URL` to the `playwright test` invocation too (global-setup uses it).
- **The `/Volumes/OWC-Express-1M2` mount nondeterministically corrupts Next's dev build artifacts.** Symptom: a served `_next/static/chunks/*.js` has a real "Invalid or unexpected token" (deterministic within one compile, varies across compiles — `md5` identical on re-fetch, differs after a recompile), so the page JS never executes (`window.__e2eSignIn` never installs → every sign-in times out), and admin `*-manifest.json` reads fail ("Unexpected end of JSON input" → 500). The larger app (admin, ~25 pages) corrupts far more often than web. **Fix: move the build dir off the mount** — `rm -rf apps/<app>/.next && ln -s /tmp/<app>-next apps/<app>/.next` (dev reuses `.next` without deleting it, so the symlink redirects all chunk writes to local disk). Disabling the webpack cache (`config.cache=false`) does *not* fix it (corruption is in freshly-compiled output, not the cache); `config.devtool=false` is ignored by Next dev. Verify by `node --check`-ing each route's served chunks before running. NB: `next dev` rewrites `tsconfig.json` (adds `<distDir>/types` to `include`) — `git checkout` it before committing.
- **The suite bit-rots against UI overhauls and must be re-validated, not trusted.** The M11.1 fixtures/specs silently broke against M12/M13/M14: `signIn` waited on a removed "signed in as" badge (login now redirects to `/chat`); selectors asserted removed controls (inline upload panel → popover; `<select>` voice picker → `.chip` pills; knowledge review-queue dropdown → kanban); group/badge labels are **i18n dictionary values uppercased by CSS**, so Playwright (which matches `textContent`, not the CSS transform) needs the dict value matched case-insensitively, not the uppercased rendered text. An attribution like "AI rendition of X" was moved to an `aria-label` (assert via `[aria-label*=…]`, not `getByText`).
- **Two real E2E-stack env gaps, both worth baking into config/global-setup:** (1) the M14 access-control whitelist denies any email not in `allowed_emails`, so `global-setup.ts` must seed the `e2e-admin@`/`e2e-expert@` identities there (role is *synced from* the whitelist by `POST /me/admin-session`) — otherwise every portal spec hits Access Denied; (2) the M11.2 per-IP rate limiter (300/60s) sees the whole single-machine run as one loopback IP, so a full-suite burst 429s mid-run (surfacing as e.g. `GET /conversations` → "couldn't load") — relax it with `RATE_LIMIT_MAX` (baked into the managed `webServer` env). Also: specs that persist profile state (the i18n toggle writes locale to the profile via `PATCH /me/locale`) **pollute later same-user specs** because the profile seeds the UI on sign-in — reset it in a failure-safe `afterEach`, and have global-setup pin all test identities to a known default at the start of the run.

**Rule:** To run the in-sandbox E2E stack: symlink each app's `.next` to `/tmp` (the mount corrupts dev chunks), start services manually with `E2E_NO_WEBSERVER=1`, and treat the suite as bit-rotted until re-validated against the live DOM — match CSS-uppercased i18n labels case-insensitively, seed the M14 whitelist + relax the M11.2 rate limit in global-setup/config, and reset any profile state a spec persists so it can't leak into later specs.

---

## 23. The OWC mount can silently truncate a just-edited file before `git add` captures it — verify line count/integrity right before committing

**Context:** M15.3.5 — after a successful `Edit` to `project-mds/PRD.md` (the tool reported success and the change was present), the next `git add` + commit recorded a file truncated by 194 lines: everything after the edited region (M15.2.6 onward — M15.3.x, M12/M13/M14 detail, Open Decisions, Non-Technical Requirements) was gone, and the commit stat read `1 insertion, 194 deletions` for a one-line manifest change.

- **The same `/Volumes/OWC-Express-1M2` mount that corrupts Next dev chunks (#22) also truncates ordinary source/markdown files** — not just build artifacts. The Edit applied to a full 463-line file; between the edit landing and `git add` reading it back, the on-disk file lost its tail, so git committed the truncated version. The other 7 files in the same commit were intact, so it is *nondeterministic and per-file*, not a systematic editor bug.
- **The fix is non-destructive recovery, not a force-push:** the full file still existed in the prior commit, so `git show <prev>:path > path`, re-apply the intended edit, verify `wc -l` matches the expected count + the tail is present, then land a *new* restorative commit (`194 insertions, 1 deletion` — the exact inverse of the corruption). No history rewrite of an already-pushed `main`.
- **Detection is cheap and must be routine:** after editing a large file on this mount, check `wc -l` and `tail` before committing, and after `git add` sanity-check the commit stat — a one-line change showing hundreds of deletions is the tell. `diff -q <(git show HEAD:path) path` per committed file confirms HEAD == disk.
- **Second manifestation (M17.2): the mount corrupts the `.git` *loose object* `git add` writes, not the source file.** The working `BUILD-NOTES.md` was intact (`wc -l`/`tail` clean, `git hash-object` == the recorded OID), `git commit` succeeded, but `git push` failed with `fatal: loose object <oid> ... is corrupt` / `inflate: data stream error`. `git fsck` showed the blob (reachable from HEAD) plus an unrelated *dangling* corrupt blob. **Repair when the working file is good and hashes to the same OID:** `rm .git/objects/<xx>/<rest>` then `git hash-object -w <file>` rewrites the loose object cleanly (same content → same OID, fresh compression); confirm with `git cat-file -p <oid> | tail`. A *dangling* corrupt object (`git rev-list --objects --all | grep <oid>` finds nothing) is unreachable and never blocks a push — ignore it. Verify the push set is clean before retrying: `git rev-list --objects HEAD ^origin/main | cut -d' ' -f1 | while read o; do git cat-file -e "$o" || echo CORRUPT $o; done`.

**Rule:** On the OWC mount, never trust that a successful Edit/`git add` persisted intact — before committing verify the source file's line count + tail; on a push that fails with `loose object … is corrupt`, check whether the bad object is reachable from your push set (`git rev-list --objects HEAD ^origin/main`) — if the working file is good, `rm` the loose object + `git hash-object -w` to rewrite it; if it's dangling/unreachable, ignore it. Recover a truncated *source* file from the last good commit. No force-push needed in any case.

---

## 24. An SSE stream consumer must never `JSON.parse` a frame's data payload unguarded — one empty keep-alive frame aborts the whole answer

**Context:** Correctness review of the real LLM drivers (commit 860e7c2, `packages/ai/src/llm/`) — Code Review Cycle 0, the drivers' first correctness pass.

- All three production drivers (OpenAI/Anthropic/Gemini) looped over SSE events as `const data = sseData(event); if (data == null || data === "[DONE]") continue; const frame = JSON.parse(data)`. SSE comment lines (`: …`) were correctly skipped (→ `sseData` returns `null`), **but an empty `data:` frame was not**: `sseData("data:")` returns `""` (a `data:` line *is* present, its payload is just empty), which is neither `null` nor `"[DONE]"`, so the code reached `JSON.parse("")` → `SyntaxError: Unexpected end of JSON input`. That rejects the async generator and aborts the entire answer mid-stream — the user sees a truncated/failed response from a single stray frame.
- Empty `data:` frames are not exotic: SSE keep-alives and proxies/load-balancers (and some API gateways) inject blank data frames to hold the connection open. The SSE spec itself says a consumer **must ignore** data it can't parse — throwing is the wrong behavior.
- Fix at the single shared choke point (`http.ts` `parseSseJson<T>()` used by every driver): return `null` for a frame with no usable JSON — no `data:` line, the `[DONE]` sentinel, an empty/whitespace-only payload, or an unparseable fragment (wrapped `try/catch`) — and have callers `continue` on `null`. The terminal `estimateUsage()` fallback still guarantees non-zero cost logging when no usage frame arrives, so resilience doesn't cost the margin signal.
- Tests that pass a clean, well-formed stream never catch this — the regression only appears with a malformed/blank frame interleaved. Add an explicit "empty/keep-alive frame mid-stream does not abort" case per driver, plus unit tests for the parse helper's null cases.

**Rule:** When consuming SSE (or any newline-framed stream) from an external service, route every `JSON.parse` through one guarded helper that skips empty/sentinel/unparseable frames instead of throwing — a blank keep-alive frame must not abort the stream — and test it with a malformed frame interleaved, not just a clean payload.

---

## 25. The `lint:css` glob collides with Next.js build output — anyone who has run the app locally gets hundreds of false stylelint failures

**Context:** Verifying gates before a UI commit, with the live E2E stack having been run locally (`apps/admin/.next` → a build dir under `apps/admin/tmp/`).

- The root `lint:css` script globs `"apps/**/app/**/*.css"`. Next.js emits compiled stylesheets at paths like `apps/<app>/.next/static/css/app/page.css` (or, when `.next` is symlinked to dodge the OWC-mount dev-chunk corruption per LEARNINGS #22, at the symlink target e.g. `apps/admin/tmp/admin-next/static/css/app/page.css`). Because that build path literally contains a directory named `app`, the source glob `apps/**/app/**/*.css` matches it — and stylelint, which does **not** honor `.gitignore`, lints the minified build CSS → 500+ false `unit-disallowed-list`/`comment-whitespace-inside` errors that have nothing to do with your change.
- The trap is invisible in CI / a fresh checkout (no `.next` exists yet), so the gate is reported "clean" by agents who never ran the app — but the live-stack E2E recipe (LEARNINGS #22) *requires* running the app, so the next agent who does so hits a wall of failures and may think they broke the design system.
- Fix: add a repo-root `.stylelintignore` excluding build output (`**/.next/**`, `**/tmp/**`, `**/dist/**`, `**/.turbo/**`, `**/coverage/**`, `**/node_modules/**`). stylelint auto-reads `.stylelintignore` from cwd, so the existing `lint:css` script needs no change. To confirm only build artifacts are the cause before adding it, re-run stylelint with `--ignore-pattern "**/tmp/**" --ignore-pattern "**/.next/**" …` and verify exit 0.

**Rule:** A lint/format glob that can match a directory name appearing in build output (`app`, `src`, `dist`) needs an ignore file for that build output — never assume "clean in CI" means clean for an agent who has run the app locally. Diagnose a wall of generated-file lint errors by grouping failures by path prefix; if they're all under `.next`/`tmp`/`dist`, it's the glob, not your code.

---

## 26. A mirrored authorization field is only as fresh as its write paths — sync it on every source-of-truth change, or the guard reads stale privilege

**Context:** Security Cycle 2 / Architecture Cycle 2 — Critical "stale admin/expert roles can keep calling privileged APIs after whitelist removal" (M14 access-control).

- The `allowed_emails` whitelist is the *intended* source of truth for admin/expert access, but the API authorization guard (`RolesGuard`) actually reads a **mirror**: `users.role`. That mirror was only written in one place — `AdminSessionService` at portal sign-in. The whitelist mutation paths (`AccessControlService.remove`/`updateRole`) changed `allowed_emails` but never the mirror, so a removed/demoted operator kept their stale `users.role` (and, for admins, the `is_admin` RLS GUC) and could keep calling `@Roles` APIs directly with a still-valid Firebase token until they happened to re-sign-in to the portal. Invite-only access was effectively a UI/session gate, not an API gate.
- Root cause is the classic mirror-staleness trap: when a guard reads a *denormalized copy* of an authorization fact, every mutation of the original must write through to the copy (or the guard must re-derive from the source on each request, fail-closed). A read-time check and a write-time sync that disagree on which store is authoritative leaves a silent gap exactly the size of "between mutation and next sync."
- Fix: write through `users.role` from the whitelist mutations in the same admin-RLS transaction (`remove` → `user`, `updateRole` → the new role; case-insensitive email match, `updateMany` so it no-ops for invitees who never signed in), **and** reconcile defensively at the sign-in gate (the 403 path downgrades a stale elevated role before refusing). Belt (immediate revocation at the mutation) and suspenders (reconciliation at the next gate touch).

**Rule:** When an authorization guard reads a mirrored/denormalized copy of a permission fact, treat every mutation of the source of truth as also a mutation of the mirror — write through synchronously in the same transaction (and/or fail-closed re-derive at read time); a sync that only runs at sign-in/login leaves stale privilege live until the next login.

---

## 27. A selector that scopes *presentation* is not a *retrieval* boundary — the data filter must carry the same scope

**Context:** Security Cycle 2 / Architecture Cycle 2 — Critical "selected expert voice is not a knowledge boundary" (M1.2 retrieval + M2 voice).

- The chat `expertId` drove voice-example retrieval, prompt persona, and conversation persistence — everything *presentational* — but knowledge retrieval (`PgVectorStore`) filtered chunks only by `status`/`language`/`scope`, with no expert predicate. So selecting Expert A's voice could ground a cited, fluent answer in Expert B's (or global) published knowledge that A never signed off on — the exact reputation boundary the product promises ("voice layered over *that expert's* approved facts") was unenforced. The `Document.expert_id` column existed but no flow set it and retrieval never joined back to it; `Chunk` doesn't denormalize it.
- The trap: a scope chosen in the UI feels like it "scopes the answer," but it only scopes the parts that *read* it. The grounding query is a separate code path; unless the same scope is threaded into its `WHERE` clause, the boundary is cosmetic. A reviewer notices because the voice layer and the fact layer are deliberately separate seams (voice can't substitute for a fact) — that same separation means the expert scope must be applied to *both* seams, not just the voice one.
- Fix: thread `expertId` into the retrieval filters (`@expertos/shared` + `@expertos/ai` types), and in `PgVectorStore` add an `EXISTS` join back through `document_versions → documents` admitting only `d.expert_id = $expertId OR d.expert_id IS NULL` (the expert's own knowledge **plus** the unattributed/global corpus — the "secondary corpus" policy), never another expert's. Wire the chat seam to pass the selected `expertId`; **fork the retrieval cache key on it** (a per-expert chunk set must not be served to another expert or the neutral voice); add the attribution path (`expertId` on `IngestionInput` → `Document.expert_id` at creation) so the boundary is usable. Neutral voice (no `expertId`) keeps the full published corpus.

**Rule:** When a UI selector narrows what an answer should be grounded in (an expert, a tenant, a project), apply that scope to the *retrieval query's* filter, not only to the voice/persona/persistence that reads it — and fork every cache key the scope now influences. A scope that only the presentation layer honors is not a security boundary.

---

## 28. An entitlement defined in the catalog but not wired to its route is a phantom control — and on a NestJS upload route, guards run before interceptors so the gate beats the file buffer

**Context:** Security Cycle 2 — Critical "document-upload entitlement is defined but not enforced before parse/embed work" (M5.1 uploads + M6.1 entitlements).

- The `plan_entitlements` catalog defined `document_upload` and disabled it for Free, the admin matrix editor showed it, and `GET /me/entitlements` reported it — so every signal said it was enforced. But `POST /uploads` carried only `@Roles("user")`; the `@RequiresEntitlement` decorator that the `EntitlementGuard` keys off was never applied. The expensive validate→scan→parse→chunk→embed pipeline ran for any authenticated user regardless of plan. The catalog entry was a *phantom control*: it described a boundary that no code path enforced.
- The trap: a feature appearing in the entitlement catalog / admin UI / `/me/entitlements` read path looks enforced from every angle except the one that matters (the route decorator). Enforcement is opt-in per route; defining the feature does nothing on its own. Grep the catalog feature keys against `@RequiresEntitlement(` usages to find phantom controls.
- Fix: add `@RequiresEntitlement("document_upload")` to the route. Reserve-before-work is automatic here because NestJS runs **guards before interceptors** — the global `EntitlementGuard` rejects a disabled boolean entitlement with `402` before the `FileInterceptor` buffers the multipart body or any service work begins. No service change; reuses the same M6.1 choke point chat gates through.

**Rule:** Every entitlement-catalog feature must have a matching `@RequiresEntitlement` on the route(s) that consume it — defining the feature does not enforce it; periodically diff catalog keys against decorator usages. On NestJS, place the entitlement/role gate as a guard (not interceptor logic) so reserve-before-work holds even for file-upload routes, where guards fire before the body is buffered.

---

## 29. A grounding/trust signal must key off the *final answer's* resolved citations, not what retrieval found — the model can return fluent prose that cites nothing

**Context:** Product Cycle 1 — High "citationless answers can still be delivered as ordinary expert answers without the honest limitation state" (M3.4 insufficient-knowledge + M4.1 citation resolvability + the new real-LLM drivers).

- ExpertOS's core promise is grounded, cited expert knowledge, with an honest "I don't know, here's why" fallback. The pipeline correctly stripped unresolvable citation markers (`buildCitations`) and only persisted citations that resolve to a retrieved chunk. But the *product-level* insufficient/ungrounded signal was computed as `facts.length === 0` — "did retrieval find anything" — and threaded into the client `done` event, the concierge silent-review trigger, and consultation routing.
- The gap: retrieval finding facts does not mean the final answer used them. A real OpenAI/Anthropic/Gemini reply can be fluent prose that cites nothing — forged `[n]` markers that get stripped, or answering from nearby context without attaching any marker. With `facts.length > 0` the turn was treated as an ordinary grounded answer (no amber notice, no silent review, no low-confidence consultation rule), silently losing the trust contract. Prompt instructions help but the product cannot rely on model obedience once a real model sits behind the seam.
- Fix: derive the trust signal from the *final* answer — `ungrounded = built.citations.length === 0` (counting both knowledge and upload citations) — and thread that single value through every downstream consumer (notice, concierge enqueue, consultation recommend). Caching was already correct (write-through gated on `built.citations.length > 0`). This is the citation-side sibling of #27: a signal that only the persistence/cache layer honored but the user-facing/quality seams ignored is not actually a boundary.

**Rule:** When a product guarantee depends on whether an answer is *grounded/cited/verified*, compute the signal from the final emitted answer's resolved-citation count (post-stripping), never from upstream retrieval/candidate counts, and thread that one value through every consumer — user notice, human-review queue, recommendation routing, analytics, and persistence — because a generative model can produce confident, uncited prose even when grounding material was available.

---

## 30. Deleting a DB row is not deleting the data — a row that points at an external object must reclaim the object too, after the row commits

**Context:** Security Cycle 2 — High "retention/user deletion removes DB rows but not raw upload objects" (NT.3 data-retention sweeper + M8.4 GDPR user-deletion cascade + the M5.1 upload storage seam).

- Both deletion paths only dropped the `uploaded_files` *rows*: `RetentionService.sweep` `deleteMany`'d expired uploads (chunks cascade), and `AdminUserService.executeDeletion` hard-deleted the user so Postgres `ON DELETE CASCADE` removed the uploads. The raw bytes — recorded as a `gcs_uri` on each row and living in the object store, *outside* Postgres — were never touched, so they outlived the rows indefinitely. The `StorageProvider` seam had `put` but no `delete`, so there was literally no way to reclaim them; the gap was invisible because the offline default (`InMemoryStorageProvider`) holds bytes in a `Map` that dies with the process, masking the leak that a real GCS bucket would exhibit.
- Two ordering traps: (1) `deleteMany`/cascade returns only a *count*, not the deleted rows, so the object keys must be `findMany`'d **before** the delete or they're gone; (2) the object delete must run **after** the row delete commits and **outside** the tx — deleting inside the tx lets a storage failure roll back the purge, and deleting before the row delete risks orphaning a live row if the tx rolls back. The only safe sequence is: collect-URIs-in-tx → delete-rows-in-tx → commit → reclaim-objects-best-effort (logged + swallowed; an orphaned object is recoverable and a re-run retries it, so the storage `delete` must be idempotent).
- The seam also had to become *shared*: a single `STORAGE_PROVIDER` instance (a `StorageModule` imported by both the upload module and the admin module) so a `put` from the upload path is deletable by the retention/deletion paths — two independent provider instances would each hold their own state (offline) or just be wasteful (GCS).

**Rule:** When a DB row references bytes in an external store (object storage, a CDN, a search index), every delete path for that row must also delete the external object — collect the object keys *before* the row delete (the delete returns only a count), run the object delete *after the row commits and outside the transaction* as a best-effort idempotent cleanup, and provide the store as one shared instance so the write path and every cleanup path operate on the same backing store.

---

## 31. A webhook idempotency key must be unique per *lifecycle transition*, not per *entity* — a fallback keyed on the entity id silently swallows later events

**Context:** Security Cycle 2 — High "TidyCal fallback idempotency can skip later cancel/reschedule lifecycle events" (M7.3 booking-confirmation sync / OD#10).

- `BookingService` dedupes booking webhooks on `[provider, eventId]`. When TidyCal omits a delivery-unique `id`, `HttpTidyCalProvider.parseEvent` fell back to `eventId = bookingRef`. That made the idempotency key per-*booking* instead of per-*event*: `created`, then `rescheduled`, then `cancelled` for the same booking all hashed to the same key, so every event after the first was treated as a duplicate and dropped. The booking's status/schedule/revenue attribution then froze at "created" forever. The bug is invisible in a single happy-path test (one event per booking) and only surfaces across a lifecycle sequence with no webhook id.
- The fix is a fallback that stays *deterministic* (a redelivery of the same transition must still dedupe) yet *distinct per transition*: `fallback:<entityRef>:<eventType>:<lifecycleStamp>`, where the stamp is the timestamp that advances on *that* transition (cancel time / reschedule time / create time), with the new scheduled time as a backstop (it moves on every reschedule) and a literal `na` only when nothing usable exists. Adding just `eventType` separates created/rescheduled/cancelled; adding the timestamp separates repeated same-type transitions (two reschedules).
- Rejecting timestamp-less events (the reviewer's alternative) was wrong here: dropping a cancel would defeat the no-vanish guarantee. Synthesize a best-effort distinct key and keep the event; the only residual collision (two timestamp-less *same-type* transitions) is one the provider doesn't actually emit.
- Apply the same shape to every driver of the seam (the offline/test provider had the identical `eventId ?? entityRef` collision) so behavior can't drift between drivers.

**Rule:** An idempotency/dedup key for lifecycle events must identify the *transition*, not the entity. When the provider gives no delivery-unique event id, synthesize one from `entityRef + eventType + a transition timestamp` — never the bare entity id, which collapses the entity's whole lifecycle into one key and silently swallows every event after the first. Test the full create→update→delete sequence with no provider id, not just one event.

---

## 32. `NEXT_PUBLIC_*` is inlined at `next build`, so injecting it into the E2E `next start` runtime is a silent no-op — the apps must be *built* with the e2e env

**Context:** Host E2E debugging session (2026-06-03) — every spec hung 60s on the Google login screen instead of being signed in programmatically.

- The suite bypasses the Google popup via `window.__e2eSignIn`, installed by each app's `lib/firebase.ts` behind a guard: `if (window && process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST)`. `playwright.config.ts` injects that var (and the other `NEXT_PUBLIC_*` client vars) into the managed `webServer` env — but the webServer runs the apps in **production** mode (`next start`), and Next inlines `NEXT_PUBLIC_*` into the client bundle at **build** time. A var set only at `next start` runtime never reaches the already-frozen bundle, so the guard stays false, `__e2eSignIn` is never installed, and `fixtures/auth.ts`'s `waitForFunction(() => typeof window.__e2eSignIn === "function")` times out — presenting as a stuck login page, not an auth error. The config comment even mislabels these as "the web/admin **dev** servers need" (dev reads env per-compile; prod does not), which is the trap.
- Fix: build web + admin **with the e2e env exported** so the var inlines truthy and dead-code-elimination leaves `window.__e2eSignIn=` installed unconditionally. Verify by grepping the built chunk: a correct build shows `window.__e2eSignIn=` *without* the `..._EMULATOR_HOST&&` guard prefix. The repo's `scripts/test-e2e-users.sh` / `scripts/test-e2e-admin.sh` encode the full recipe (build-with-env → free ports → run).
- Same class of trap also bit the build itself: `output: "standalone"` (Cloud Run) leaves a nested `.next/standalone/.../esbuild` symlink that `next build`'s pre-clean chokes on with `recursiveDelete ENOENT` — `rm -rf apps/{web,admin}/.next` before building clears it.

**Rule:** Any client-read `NEXT_PUBLIC_*`/build-time-inlined config that an E2E (or prod) flow depends on must be present in the **build** environment, not just the server's runtime env. When a feature gated on such a var silently fails to activate under `next start`, suspect a build done without it before debugging the runtime. Verify the value is actually baked into the emitted bundle.

---

## 33. A structured `HttpException` object response with no `message` leaks the framework's bare "Http Exception" string to any client reading `message`

**Context:** Product Cycle 1 Medium (2026-06-03), found via E2E M15.3.7 — a Free-plan document upload was correctly rejected (402) but surfaced to the user as a red badge reading literally **"Http Exception"**.

- The entitlement guard throws `new HttpException(payload, 402)` where `payload` is a *structured* object (`reason`/`feature`/`currentPlan`/`upgradeOptions`/`remainingQuota`) — intentionally carrying no human-facing `message`. `AllExceptionsFilter.extractHttpMessage` looks for `"message" in response`; finding none, it falls back to `exception.message`, which for an object-response `HttpException` is the class default **"Http Exception"**. The filter then echoes that as `body.message`.
- Any client that pulls `body.message` for its error UI (the web upload client's old `errorMessage()`) renders that leaked framework string verbatim — the user sees a meaningless error with no path forward, even on a screen that already shows an "UPGRADE →" affordance.
- Fix: don't rely on a `message` that the payload never set. The client recognizes the structured payload by shape (a 402 whose body has `reason ∈ {feature_disabled, quota_exceeded}` + string `feature` + array `upgradeOptions`) and throws a **typed** error (`UploadEntitlementError` carrying the payload); the UI then renders a localized, actionable prompt + an upgrade link from the typed payload, and falls back to `{ message }` only for the genuinely message-bearing errors (415/413/422/400). Alternatively the server could add a derived `message` to the payload — but a typed client error keeps localization (EN/VI) on the side that owns the dictionaries.

**Rule:** When you throw a structured `HttpException(objectPayload, status)` whose payload omits `message`, the client will receive the framework's default "Http Exception" string, not your payload — so either include a user-facing `message` in the payload, or have clients branch on the payload's *shape* (typed error) rather than reading a `message` that isn't there. Never render a raw error `message` to users without confirming the producing path actually sets one.

---

## 34. An access/status guard *inside* the transaction that does the expensive work still allows cost-amplification — the cheap precheck must run before the work

**Context:** Security Cycle 3 Medium (2026-06-03) — the M8.1 draft-version edit path (`IngestionService.editDraftContent`) ran the full chunk → summarize → embed pipeline on the request body *before* the version's existence/draft-status was validated.

- The only existence/draft-status guard lived inside `DocumentVersionRepository.replaceDraftChunks`'s RLS transaction — which is the right place to close the concurrent-submit race (a published version can't be slipped under the edit). But that transaction runs *after* `chunkAndEmbed` has already spent the summarize + embed cost. So an authenticated expert/admin could drive arbitrary ML cost against a non-existent, RLS-hidden (foreign-tenant), or non-draft (`expert_review`/`published`/`archived`) `versionId`, and only then get the `404`/`409`.
- It *looks* safe because the guard is atomic and transactional — the non-obvious part is that "guarded" and "guarded before spending resources" are different properties. Atomicity protects correctness; it does nothing for cost.
- Fix (reserve-before-work, DIRECTIVE #44/#28 ordering): add a cheap, RLS-scoped precondition (`assertDraftEditable` — one `findUnique({ select: { status } })`) that fails fast with the same `404`/`409` *before* `chunkAndEmbed`, and **keep** the authoritative in-tx guard so the race stays closed. The duplication is intentional: the precheck is for cost, the in-tx check is for correctness.

**Rule:** Reserve-before-work means the validity/existence/authorization check must precede the expensive step (embedding, LLM calls, large parsing) — a guard sharing a transaction with the work runs *after* it, so add a cheap precheck even when an authoritative in-transaction guard already exists (the precheck saves cost; the in-tx guard closes the race).

---

## 35. The Firebase Auth emulator is in-memory — a restart reassigns uids, so DB rows keyed on the old uid go stale and break first-sign-in user creation

**Context:** Host E2E debugging session (2026-06-03) — `global-setup` failed with `GET /me (500)` for every identity after the Auth emulator was restarted between runs.

- `AuthService.resolveUser` (the first-sign-in mirror path) looks up the user by `firebase_uid`, and on a miss **creates** a new row. The Auth emulator started with `--only auth` (no `--import/--export`) is **in-memory**: every restart wipes the accounts and reassigns each test email a brand-new uid on next sign-in. The DB still holds the *previous* session's uid for that email, so the uid lookup misses, the create runs, and it hits the `email` unique constraint → a 500 (surfacing as `PrismaClientKnownRequestError: Unique constraint failed` on `tx.user.create`). It looks like an API/DB fault but is purely emulator-uid churn vs. persisted rows. It only reproduces *after* an emulator restart, so a single uninterrupted session hides it.
- Fix (in `e2e/global-setup.ts`): before mirroring each identity via `/me`, reconcile the DB — decode the current uid from the emulator token (an unsigned JWT; the `user_id`/`sub` claim) and `updateMany({ where: { email, firebaseUid: { not: uid } }, data: { firebaseUid: uid } })` under the admin RLS context. The existing row is repointed to the live uid, so `/me` resolves it instead of trying to create a duplicate. A no-op when the uid already matches (no restart). The alternative — persisting the emulator with `--import/--export` so uids survive restarts — also works but depends on every operator starting it the right way; the in-setup reconcile makes the suite robust regardless.

**Rule:** Any data keyed on an identifier minted by an ephemeral/in-memory auth provider (emulator uids, local OIDC subjects) must be reconciled, not assumed stable — when test setup persists rows by a provider id, repoint them to the current id (matched on a stable natural key like email) before the app's first-sign-in path runs, or a provider restart makes every persisted row a unique-constraint landmine.

**Rule:** Reserve-before-work means the validity/existence/authorization check must precede the expensive step (embedding, LLM calls, large parsing) — a guard sharing a transaction with the work runs *after* it, so add a cheap precheck even when an authoritative in-transaction guard already exists (the precheck saves cost; the in-tx guard closes the race).

---

## 36. A "webhook secret" is dead weight if the vendor has no webhooks — verify the integration's delivery model before building verification for it

**Context:** M16 (2026-06-05) — the booking integration was built around an inbound TidyCal webhook: a `TIDYCAL_WEBHOOK_SECRET`, HMAC-SHA256 verification over the raw body, a `tidycal-signature` header, and (in the planned per-expert design) a per-expert webhook URL + rotatable path token. But **TidyCal has no native webhooks** (its own FAQ: *"TidyCal does not currently offer native webhook support"*). TidyCal never POSTs anything to us, so none of that machinery could ever fire.

- Worse than inert: in `tidycal.defaults.ts` the presence of `TIDYCAL_WEBHOOK_SECRET` was the *gate* that selected the real provider over the offline one — so you couldn't enable the only mechanism that actually works (the REST `GET /bookings` poll, behind `TIDYCAL_API_TOKEN`) without also setting a secret that guarded a door no one knocks on. The webhook path only makes sense with a third-party relay (Zapier/Make/Pabbly) standing between the vendor and us, computing the HMAC — infrastructure that didn't exist and was explicitly ruled out.
- The fix wasn't to harden the webhook; it was to delete it. Production booking sync became **per-expert polling** of `GET /bookings` (the `reconcile`/`listBookings` engine already existed for "missed-event recovery"), with each expert's API token encrypted at rest. The offline JSON-envelope seam was kept for local/dev/test only — and hardened to **refuse to run in production**, because an unsigned-envelope handler reachable on a `@Public` route is a forged-booking vector if prod is ever misconfigured to resolve the offline provider.

**Rule:** Before implementing signature verification, idempotency ledgers, or per-tenant webhook routing for a third-party integration, confirm the vendor actually *delivers* webhooks (check their docs/FAQ, not an assumption). If they only expose a polling API, the sync path is a scheduled poll — and any inbound "webhook" route you keep for testing must be inert (or hard-disabled) in production so it can't be used to inject unsigned events.

---

## 37. A maintenance/CLI entry point that "mirrors" a guarded domain operation must reuse the gate, not re-implement around it

**Context:** Security Cycle 4 + Product Cycle 2 (2026-06-05) — a `publish-drafts` CLI was added to bulk-publish knowledge. It copied the *side effects* of `KnowledgeService.approve` (version→published, chunks→published, doc-pointer move, archive prior) but deliberately **relaxed the precondition**, publishing `draft` versions directly and skipping the AI-processing + expert-review gates. Result: a server-side operator/deploy job could make unreviewed drafts retrieval-visible and groundable in cited user answers — the exact trust failure the review gate exists to prevent — while stamping a fake SYSTEM approver, writing no audit row, and leaving caches stale.

- Root cause: the gate (publish only an `expert_review` version) lived *inside* `approve` as an inline check, so a second entry point could re-create the mutations without it. The publication invariant wasn't owned by a single enforceable unit.
- Fix: extract the mutations into one shared primitive (`publishReviewedVersionTx`) that **contains the gate itself** (throws if `status !== "expert_review"`), and route BOTH `approve` and the (rewritten, `expert_review`-only) bulk CLI through it. The CLI additionally requires a break-glass env flag + a validated `--approver` user and writes an audit row. Now no caller — present or future — can publish unreviewed content, and the retrieval-visibility side effects can't drift between entry points.

**Rule:** When a CLI/migration/job performs the same state transition as a guarded domain method, make it call the *same* gated primitive (with the precondition enforced inside that primitive), never a hand-copied sequence of the underlying writes — a re-implementation silently drops the authorization/audit/cache side effects and becomes a bypass.

---

## 38. A per-principal credential that fails to decrypt must skip the principal, never fall back to a shared/global credential

**Context:** Security Cycle 4 + Product Cycle 2 (2026-06-05) — `TidyCalProviderFactory.forExpert` decrypted each expert's stored TidyCal token to poll *that expert's* calendar, but on decrypt failure (rotated `CREDENTIALS_ENCRYPTION_KEY`, corrupt ciphertext, bad migration) it caught the error and fell back to `this.default()` — the env-global `TIDYCAL_API_TOKEN`. The caller still scoped/attributed every polled booking to the original expert id. So a credential failure for expert A would poll the *shared* calendar and record its bookings/revenue under expert A: silent cross-principal data attribution drift.

- Root cause: "degrade gracefully instead of crashing the poll" was implemented as "fall back to the default provider," conflating two cases that must diverge — *no configured credential* (the global default is the intended safety net) vs *a configured credential that won't decrypt* (falling back means acting as someone else).
- Fix: `forExpert` returns `null` (skip) when a configured token won't decrypt; the caller drops that target, counts it as `failedTargets`, logs a warn, and surfaces the count to the operator. The global fallback is kept ONLY for an expert with no configured token (and the no-expert legacy poll).

**Rule:** Distinguish "no credential configured" (fall back to the shared default if that's the design) from "a credential is configured but unusable" (skip + alert) — never let a decrypt/parse failure of a per-principal secret silently resolve to a different principal's or a global credential, or you misattribute that credential's data to the failing principal.

## 39. A sync `getByRole` for a *controlled, checked* radio can miss it right after an async `findByRole` — use async `findByRole`

**Context:** M19.3.1 (concierge-settings radio cards) — the new test queried `await findByRole("radio", { name: "Off" })` then a synchronous `getByRole("radio", { name: "Mode A · User-prompted" })` for the *checked* option (`triggerMode: user_prompted`). The sync query deterministically failed "Unable to find" while the same query as `findByRole` passed; the two unchecked siblings (Off, Mode B) were found by sync queries fine.

- Root cause: under React 18 + the jest/RTL harness, a *controlled* `<input type="radio" checked>` commits/settles a tick after its unchecked siblings, so a synchronous `getByRole` run immediately after an async `findByRole` for a different element can observe the checked input not-yet-queryable. (The OWC mount's stale-read flakiness — DIRECTIVE #40 — amplified the confusion, but the failure was reproducible after `--no-cache`/`--runInBand`, so it is a real timing gotcha, not just contention.)
- Fix: query each radio (especially the checked/active one) with `await screen.findByRole(...)`, not sync `getByRole`. Separately, give each radio an explicit `aria-label` so its accessible name is the option title alone — deterministic, instead of the wrapping `<label>`'s whole title+badge+description paragraph.

**Rule:** In RTL, reach for async `findBy*` when asserting on a controlled/`checked` form control's presence — a sync `getBy*` immediately after an unrelated `findBy*` can race the control's commit. And when a selectable card wraps a radio, set `aria-label` on the input so the accessible name is stable and assertable.

---

## 40. An OWC-mount corruption can hit the just-written git loose OBJECT, not the working file — recover with `git hash-object -w`, don't re-clone

**Context:** M19.5.4 (audit copy parity) — after a clean `git commit`, `git push` failed with `fatal: loose object <sha> is corrupt` / `git fsck` → `inflate: data stream error (invalid stored block lengths)`. The corrupt blob turned out to be the commit's freshly-written `progress-log.md` object; the **working-tree file was intact** (correct line count, and `git hash-object` of it reproduced the exact expected SHA).

- Root cause: the OWC mount corrupted the zlib-compressed loose object as git wrote it into `.git/objects/` during the commit — a sibling of the file-truncation flakiness in DIRECTIVE #40 / LEARNINGS #23, but on the *object store* side rather than the source file. The commit succeeded locally (git read the in-memory blob) but the persisted object was unreadable, so push (which re-inflates objects to build the pack) aborted.
- Diagnosis that pinned it: `git diff-tree -r <commit>` showed the corrupt SHA was one of the commit's blobs; `git ls-tree -r` + `git hash-object <working-file>` confirmed the working file still hashed to that same SHA → only the stored copy was bad, content was recoverable in place.
- Fix (no re-clone, no reset needed): `rm -f .git/objects/<xx>/<rest>` (the loose object is mode `0444`, so `-f`), then `git hash-object -w <path>` to rewrite a fresh valid object at the identical SHA, `git fsck`/`git cat-file -s` to confirm, then push. Because content is unchanged the SHA is identical, so the existing commit stays valid.

**Rule:** On a `loose object is corrupt` push/fsck failure, first check whether the working file still `git hash-object`es to the corrupt SHA; if so the bytes are intact and you just `rm` the bad loose object and `git hash-object -w` it back — reserve re-clone/`reset` for when the content itself is lost.
