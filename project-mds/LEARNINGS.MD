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
