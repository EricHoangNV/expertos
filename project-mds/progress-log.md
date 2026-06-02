# Progress Log

Append-only task history. One entry per completed task, newest at the bottom. See PROGRESS-INSTRUCTIONS.MD for the entry format.

---

## P0.1 — Monorepo scaffold (pnpm + Turborepo) verified, fixed, and committed
**Date:** 2026-05-31
**Ref:** PRD.md Task Manifest — Phase 0, P0.1

**What was done:**
- Inherited a full but uncommitted scaffold from a prior session (apps/web, apps/admin, apps/api, packages/shared, packages/db, packages/ai, packages/ui, infra/). Progress had not been recorded and two feedback gates were failing.
- Fixed `@expertos/db` test: branch coverage was 75% (< 90% gate) because `getDatabaseUrl(env = process.env)`'s default-parameter branch was never exercised. Added a test that calls `getDatabaseUrl()` with no argument while setting/restoring `process.env.DATABASE_URL`. Coverage now 100% branches.
- Fixed `pnpm deadcode` (knip): removed unused `@expertos/shared` workspace dependency from apps/web, apps/admin, apps/api, packages/ai; removed unused `@nestjs/testing` and `@nestjs/schematics` devDeps from apps/api. Refreshed pnpm-lock.yaml. knip now clean.
- Added `.pnpm-store/` (637 MB local package cache) and `.claude/settings.local.json` to `.gitignore` so they are not committed.
- Verified all gates green: `pnpm typecheck` (9 tasks), `pnpm test` (16 tests / 5 suites), `pnpm lint` (7 tasks), `pnpm deadcode`, and `pnpm build` (7 workspaces incl. `nest build` and both Next.js apps).
- Committed the scaffold to local + origin (github.com/EricHoangNV/expertos).

**Key decisions:**
- Removed unused deps rather than masking them in knip's `ignoreDependencies`. Rationale: keeps dependency declarations honest about real usage; they get re-added when a package actually imports them (P0.3 RBAC will likely re-add `@expertos/shared` to apps/api). `@nestjs/schematics` is provided transitively by `@nestjs/cli`, so removing the direct declaration didn't break `nest build` (verified).
- Did NOT wire/fix Stylelint. `.stylelintrc.json` exists but is not part of any pnpm script or the mandated feedback loops (typecheck/test/lint/deadcode). `ds.css` reports stylelint errors; wiring the design-system guard and cleaning ds.css is explicitly P0.6's scope — deferred to avoid scope creep.

**Files changed:**
- `packages/db/src/config.test.ts` — added process.env fallback test for full branch coverage.
- `apps/web/package.json`, `apps/admin/package.json` — removed unused `@expertos/shared` dep.
- `packages/ai/package.json` — removed unused `@expertos/shared` dep (dependencies block now empty).
- `apps/api/package.json` — removed unused `@expertos/shared` dep and `@nestjs/testing` / `@nestjs/schematics` devDeps.
- `.gitignore` — ignore `.pnpm-store/` and `.claude/settings.local.json`.
- `pnpm-lock.yaml` — regenerated after dep removal.

**Notes for next iteration:**
- P0.2 is next: Prisma schema stub exists at `packages/db/prisma/schema.prisma`, but pgvector + tenant RLS migration is not done. Read PRD §"Data Model".
- When a package first imports `@expertos/shared`, re-add `"@expertos/shared": "workspace:*"` to its package.json or knip will not be the blocker — the import will fail to resolve the dep declaration.
- When the first NestJS module/controller test is written, re-add `@nestjs/testing` AND add it to knip `ignoreDependencies` (knip ignores `*.test.ts`, so a test-only dep will always be flagged otherwise — same pattern already used for `ts-jest`/`@types/jest`).
- Stylelint guard + ds.css conformance is unfinished and owned by P0.6.

---

## P0.2 — Postgres + pgvector via Prisma; tenant-ready schema + RLS migration
**Date:** 2026-05-31
**Ref:** PRD §"Data Model" (Task Manifest P0.2)

**What was done:**
- Authored the full multi-tenant Prisma schema (`packages/db/prisma/schema.prisma`) — 36 models across identity/billing, versioned knowledge, conversations, concierge, uploads, consultation, cache, and security/audit, plus 22 enums. Every knowledge/content row carries `tenantId` (defaults to the GLOBAL tenant `00000000-…-0000` via `dbgenerated`) + `scope`.
- pgvector: `embedding Unsupported("vector(1536)")` on `chunks`, `upload_chunks`, `voice_examples`, `semantic_cache`; HNSW cosine indexes added in the RLS migration (Prisma can't index Unsupported columns).
- Two migrations applied via `prisma migrate deploy` against Postgres 16 + pgvector 0.8.2 (Docker): `init_schema` (tables/enums/FKs/indexes) and `rls_and_vector_index` (RLS).
- RLS migration: `app` schema with `current_tenant_id()/current_user_id()/is_admin()` GUC helpers; non-superuser `app_user` role (NOLOGIN) + grants; ENABLE+FORCE RLS with permissive policies on all tenant/user tables — tenant-only, tenant+user, and knowledge (own-tenant write / own+GLOBAL read) policy classes; `document_topics` scoped through its parent; HNSW indexes.
- `applyRlsContext(tx, {tenantId, userId, isAdmin})` helper (`src/rls.ts`) — sets the three GUCs via parameterized `set_config(..., true)` (transaction-local), validates UUIDs as defense in depth. Exported with `prisma` singleton (`src/client.ts`) and the generated client from `src/index.ts`.
- Idempotent seed (`prisma/seed.ts`): GLOBAL tenant, Free/Plus/Premium plans + prices ($4.99 / $9.99·$69.99), 7-feature entitlement catalog, and the 3×7 plan×feature matrix (placeholder quotas per Open Decision #4), + an intro consultation type.
- Verified RLS end-to-end through Prisma as `app_user`: deny-by-default (no context → 0 rows), tenant+user isolation, cross-tenant write blocked by `WITH CHECK`, GLOBAL expert knowledge cross-tenant readable, admin bypass. 8/8 checks pass.
- Added unit tests for `applyRlsContext` (5 tests, incl. SQL-injection-shaped UUID rejection); db package now 9 tests at 100% coverage.

**Key decisions:**
- **Library engine kept as committed default; binary engine only for local runs.** Prisma's library query engine SIGILLs on this aarch64 sandbox; rather than pin `engineType=binary` (wrong for prod amd64), I documented `PRISMA_CLIENT_ENGINE_TYPE=binary` for local Client runs. See LEARNINGS #1.
- **RLS enforced via a non-superuser `app_user` + FORCE RLS**, because superusers/owners bypass RLS. The structural guarantee only holds if the app connects as `app_user`; documented for P0.3.
- **Context via GUCs + `applyRlsContext` inside a transaction** (not per-query WHERE clauses) so isolation is structural. `set_config(...,true)` is transaction-local, so it must run inside `$transaction`.
- **`vector(1536)`** chosen (OpenAI text-embedding-3-small) as a concrete default; flagged that changing the embedding model is a migration.
- Hand-wrote migrations via `migrate diff` + `migrate deploy` because `migrate dev`/`--create-only` are interactive and fail in this non-interactive shell.

**Files changed:**
- `packages/db/prisma/schema.prisma` — full schema (was a 1-model stub).
- `packages/db/prisma/migrations/*_init_schema/migration.sql` — generated tables/enums/FKs.
- `packages/db/prisma/migrations/*_rls_and_vector_index/migration.sql` — hand-written RLS + HNSW indexes.
- `packages/db/prisma/migrations/migration_lock.toml` — postgres provider lock.
- `packages/db/prisma/seed.ts` — idempotent seed (tenant/plans/features/entitlements/consultation type).
- `packages/db/src/rls.ts` + `src/rls.test.ts` — RLS context helper + tests.
- `packages/db/src/client.ts` — PrismaClient singleton.
- `packages/db/src/index.ts` — re-exports prisma, rls helpers, generated client.
- `packages/db/package.json` — `@prisma/client` dep, `tsx` devDep, `postinstall`/`build`/`typecheck` run `prisma generate`, `db:deploy`/`db:seed` scripts, prisma seed config.
- `packages/db/jest.config.cjs` — exclude `client.ts` (untestable singleton) from coverage.
- `knip.json` — ignore `@prisma/client` (consumed by the generated client outside knip's glob).

**Notes for next iteration:**
- P0.3 must connect Prisma as `app_user` (not the superuser in DATABASE_URL) and wrap request DB work in `$transaction` + `applyRlsContext`, or RLS won't enforce. `app_user` is NOLOGIN — provision LOGIN/password out of band in prod.
- The M1 VectorStore driver must use `$queryRaw` for embedding columns (Prisma Client can't touch `Unsupported`).
- `usage_logs` (with `cost_micros`, token columns) and `admin_audit_logs` already exist for P0.5 observability.
- Local DB: `docker run -d --name expertos-pg -e POSTGRES_USER=expertos -e POSTGRES_PASSWORD=expertos -e POSTGRES_DB=expertos -p 5432:5432 pgvector/pgvector:pg16`. `packages/db/.env` (gitignored) holds DATABASE_URL.

## P0.3 — Firebase Auth wiring + API token-verify guard + RBAC roles
**Date:** 2026-05-31
**Ref:** PRD.md Task Manifest Phase 0 P0.3; PRD §"Security" (AuthN/AuthZ), §"Target Architecture" (Auth guard + RBAC); DIRECTIVES §4.21 (RLS app role)

**What was done:**
- **API (`apps/api/src/auth/`)** — full auth + RBAC module:
  - `token-verifier.ts` — abstract `TokenVerifier` DI token so only one file touches the Firebase SDK.
  - `firebase-admin.provider.ts` — `createFirebaseApp(env)` (service-account creds from env; unescapes `\n` in private key; throws if missing) + `FIREBASE_AUTH` provider.
  - `firebase-token-verifier.ts` — `FirebaseTokenVerifier` (verifies via Admin SDK, maps to `DecodedIdToken`, throws `UnauthorizedException` on any failure without leaking the reason).
  - `auth.service.ts` — `AuthService.resolveUser()` find-or-creates the `users` row under an **admin/system RLS context** (tenant unknown at sign-in; `firebase_uid` globally unique). New users → GLOBAL tenant, `user` role.
  - `rls.service.ts` — `RlsService.run(user, work)` wraps request DB work in `prisma.$transaction` + `applyRlsContext` (scopes by tenant/user; `is_admin` GUC for `admin` role).
  - Guards/decorators: `FirebaseAuthGuard` (global, `@Public()`-aware, attaches `req.authUser`), `RolesGuard` + `@Roles()` (hierarchical via `satisfiesRole`), `@CurrentUser()`, `@Public()`. Both guards registered as `APP_GUARD` (auth then roles).
  - `me.controller.ts` — `GET /me` (any authed user) + `GET /me/admin` (`@Roles('admin')` gate, used by admin/expert portal access check).
  - `database.module.ts` — global module providing the `PRISMA` token from `@expertos/db`.
  - Wired `AuthModule` + `DatabaseModule` into `app.module.ts`; marked health route `@Public()`.
- **Web (`apps/web`)** — Firebase client + Google sign-in:
  - `src/lib/firebase.ts` — lazy `getFirebaseAuth()` + `isFirebaseConfigured` (module-level init breaks `next build` — see LEARNINGS #3).
  - `src/lib/auth-context.tsx` — `AuthProvider`/`useAuth` (`onAuthStateChanged`, `signInWithGoogle` popup, `signOutUser`, `getIdToken`); gated on `isFirebaseConfigured`.
  - `app/layout.tsx` wraps children in `AuthProvider`; `app/page.tsx` shows sign-in/out.
- **Deps:** `firebase-admin@13.10.0` + `@expertos/db`/`@expertos/shared` (workspace) → apps/api; `firebase@12.14.0` → apps/web. `.env.example` gained `NEXT_PUBLIC_FIREBASE_*`.
- **Tests:** added 20 API tests (auth.service, rls.service, firebase-auth.guard incl. `extractBearerToken`, roles.guard, firebase-token-verifier). Services at 100% coverage. Repo total 42.

**Key decisions:**
- **Token verification behind an abstraction** (`TokenVerifier`) so the Firebase Admin SDK is isolated to one provider and tests inject a fake — no SDK import bleeds into services/guards.
- **User resolution runs as admin/system RLS context**, not user context. The chicken-and-egg of "need tenant to query RLS-protected `users`, but tenant is on the user row" is resolved by treating sign-in lookup as a trusted system op (firebase_uid is globally unique). Documented in code + state notes.
- **`admin` role → `is_admin` GUC true** in `RlsService` so the admin/expert portals get tenant-wide visibility (matches the RLS migration's "admin + trusted jobs bypass" intent).
- **Coverage-friendly layout:** the Jest gate collects only `*.service.ts`; genuinely testable logic lives in services (100%), framework glue (guards/decorators/providers) is non-`.service.ts` but still unit-tested for security confidence.
- **Lazy web Firebase init** to keep `next build` prerender credential-free (LEARNINGS #3).
- Added `GET /me/admin` rather than a knip-ignore so `@Roles` has a real consumer and RBAC is exercised end-to-end; dropped the unused `export` on `AuthContextValue`.
- Deferred a global `ValidationPipe`/DTO layer (no request-body endpoints yet) to the first endpoint that takes input.

**Files changed:**
- `apps/api/src/auth/*` (new: token-verifier, firebase-admin.provider, firebase-token-verifier, auth.service, rls.service, firebase-auth.guard, roles.guard, public/roles/current-user decorators, auth.types, auth.module, me.controller + 5 test files)
- `apps/api/src/database/database.module.ts` (new); `apps/api/src/app.module.ts`, `apps/api/src/health/health.controller.ts` (wire + `@Public()`); `apps/api/package.json` (deps)
- `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/auth-context.tsx` (new); `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/package.json`
- `.env.example` (NEXT_PUBLIC_FIREBASE_*); `project-mds/LEARNINGS.MD` (#3); `project-mds/PRD.md` (manifest); progress files

**Notes for next iteration:**
- `RlsService` has no real consumer yet — wire it into the first CRUD endpoint (M1+). `/me` only echoes the guard-resolved user.
- Integration tests (real Postgres + Firebase emulator: token verify, RLS negative authz) are deferred to M11 per Testing Strategy. Re-add `@nestjs/testing` when a DI-container test is first needed.
- `AuthService.resolveUser` does not sync email/displayName on returning logins (find-or-create only) and defaults missing email to `""` — fine for Google sign-in (always has email); revisit if other providers are added.
- Set real `FIREBASE_*` (API) + `NEXT_PUBLIC_FIREBASE_*` (web) env to exercise the live flow; `DATABASE_URL` must use `app_user` in prod.

---

## P0.4 — Manual build & deploy (Dockerfiles + scale-to-zero Terraform + deploy scripts)
**Date:** 2026-05-31
**Ref:** PRD §"Phase 0 — Foundation" item 4 / Task Manifest P0.4

**What was done:**
- **Next.js standalone output:** added `output: "standalone"` + `outputFileTracingRoot` (repo root) to `apps/web/next.config.mjs` and `apps/admin/next.config.mjs` so the Docker images ship only traced deps. Verified the build emits `apps/<app>/.next/standalone/apps/<app>/server.js` + `.next/static`.
- **API port for Cloud Run:** `apps/api/src/main.ts` now binds `0.0.0.0:$PORT` (`process.env.PORT ?? API_PORT ?? 3001`); Cloud Run injects PORT=8080.
- **Dockerfiles** (build context = repo root, pnpm-workspace aware): `apps/api/Dockerfile` (multi-stage: `pnpm --filter @expertos/api... build` then `pnpm deploy --prod`, openssl/ca-certs for the Prisma engine), `apps/web/Dockerfile` + `apps/admin/Dockerfile` (Next standalone runner). Root `.dockerignore`.
- **Terraform (infra/)** — minimal, scale-to-zero: `main.tf` (provider + enabled APIs), `registry.tf` (Artifact Registry), `cloud_run.tf` (api + web + admin Cloud Run v2 at `min_instance_count=0`, API wired to Secret Manager env + Cloud SQL connector volume, optional `allUsers` invoker), `database.tf` (Cloud SQL PG15 smallest tier + `expertos` db), `storage.tf` (private versioned uploads bucket), `secrets.tf` (DATABASE_URL + FIREBASE_* containers), `iam.tf` (least-priv runtime SA: cloudsql.client, secretAccessor, bucket objectAdmin), `variables.tf`, `outputs.tf`.
- **Deploy scripts:** `infra/deploy.sh <api|web|admin>` (docker build → push → `gcloud run deploy --image`) + root `pnpm deploy[:api|:web|:admin]`.
- **Docs:** rewrote `infra/README.md` with the apply → out-of-band (pgvector `CREATE EXTENSION`, non-superuser `app_user`, secret values) → build/deploy → smoke-test flow.
- Confirmed the coverage gate is already enforced (`jest.base.cjs` global 90%; API config scoped to `*.service.ts`) — `pnpm test` runs it.

**Key decisions:**
- **Image-then-deploy split, not `gcloud run deploy --source`.** Buildpacks don't handle a pnpm monorepo cleanly, so Dockerfiles build at repo root and `gcloud run deploy --image` updates the Terraform-managed service (Terraform owns scaling/secrets/SQL wiring; the script only swaps the image). This keeps a clean IaC/runtime separation.
- **DB user + secret values stay out of Terraform state.** Terraform creates the Cloud SQL instance/db and empty Secret Manager containers; the RLS-enforcing `app_user` (DIRECTIVES §4.21) and all secret versions are added out of band so no plaintext/password lands in state.
- **Cloud SQL keeps a public IP (no authorized networks)** rather than private VPC — the Cloud Run Cloud SQL connector authenticates via IAM+TLS, the minimal working setup without a VPC/connector network.
- Cloud SQL is the one resource that can't truly scale to zero; used the smallest tier (`db-f1-micro`) per the "scale-to-zero everything" cost target.

**Files changed:**
- `apps/web/next.config.mjs`, `apps/admin/next.config.mjs` — standalone output + tracing root
- `apps/api/src/main.ts` — bind `0.0.0.0:$PORT`
- `apps/{api,web,admin}/Dockerfile`, `.dockerignore` — container images
- `infra/{main,variables,registry,cloud_run,database,storage,secrets,iam,outputs}.tf` — IaC
- `infra/deploy.sh`, `infra/README.md` — deploy tooling + docs
- `package.json` — `deploy*` scripts

**Notes for next iteration:**
- Dockerfiles/Terraform are **authored but not run here** (no `terraform`/`gcloud` binaries; no network for base-image pulls). The runnable parts pass: all gates green; standalone output paths match the Dockerfile COPY/CMD.
- **Stale-cache gotcha:** enabling `output: "standalone"` over a pre-standalone `.next` makes `next build` throw `SyntaxError: Unexpected end of JSON input`. Fix: `rm -rf apps/*/.next apps/*/.turbo` and rebuild.
- web/admin have no `public/` dir; Dockerfiles deliberately skip copying it (uncomment the COPY once one exists).
- NEXT_PUBLIC_* are build-time — pass via `--build-arg` when wiring P0.3 Firebase web config into deploy images.
- Before first `terraform apply` on a fresh project, either push images first or expect the initial Cloud Run revisions to go healthy only after `pnpm deploy`.

## P0.5 — Observability baseline
**Date:** 2026-05-31
**Ref:** PRD.md Task Manifest P0.5 / §"Phase 0 — Foundation" item 5 (structured logging, Sentry, request tracing, cost/usage logging)

**What was done:**
- New `apps/api/src/observability/` module (`@Global`, imported in `app.module.ts`):
  - `request-context.ts` — `AsyncLocalStorage`-backed per-request context (`requestId`, `traceId`).
  - `request-context.middleware.ts` — mints/reuses `x-request-id`, parses `X-Cloud-Trace-Context`, echoes the id in the response header, runs the request inside the async context. Applied via `configure()` `forRoutes("*")`.
  - `logger.service.ts` — `StructuredLogger` implements Nest `LoggerService` AND exposes `info/warn/error/debug(msg, fields?)`. One JSON line/stdout with Cloud Logging `severity`, ISO `time`, `requestId`, and `logging.googleapis.com/trace` (full resource path when `GOOGLE_CLOUD_PROJECT` set). Error args expanded to `{name,message,stack}`. Every line passed through `redact`.
  - `redact.ts` — recursive PII scrub of sensitive keys (email/token/secret/authorization/…), cycle-safe (directive §4.10).
  - `sentry.ts` — lazy/opt-in Sentry (`@sentry/node` 8.55.2). `initSentry()` no-ops unless `SENTRY_DSN`; `reportException` tags events with `requestId`/`traceId`; `flushSentry` for shutdown.
  - `all-exceptions.filter.ts` — `APP_FILTER` catch-all: 4xx → WARNING log, not reported; 5xx/unknown → generic 500 + ERROR log + Sentry report; `requestId` in the JSON body for support correlation.
  - `usage-log.service.ts` — `UsageLogService.record(user, entry)` writes `usage_logs` rows via `RlsService.run` (satisfies the table's `tenant_user_isolation` RLS policy). Best-effort: catches+logs failures so usage logging never breaks the user's request.
- `main.ts` — `initSentry()` first, `bufferLogs: true` + `app.useLogger(StructuredLogger)`, `enableShutdownHooks()`, bootstrap `.catch` reports to Sentry + flushes.
- Tests: 41 new (logger 15, usage-log 4, redact 4, sentry 5, middleware 6, filter 7). API now 62 tests / 12 suites; repo 83 / 17. `logger.service.ts` + `usage-log.service.ts` at 100% coverage.
- `jest.base.cjs` — added `maxWorkers: 2` + `workerIdleMemoryLimit: "512MB"` to stop OOM-SIGKILL of a worker once enough heavy suites run concurrently on this ~4 GB sandbox.

**Key decisions:**
- **No `usage_logs`/`transactions` migration needed** — those tables + cost columns already exist (P0.2 schema). P0.5 = the runtime services on top, not new DDL.
- **`StructuredLogger` registered via `useFactory`**, not class introspection: its constructor takes an optional `LogSink` (defaulted to stdout) that Nest's DI can't/shouldn't resolve; the factory sidesteps that and keeps the sink swappable in tests.
- **Sentry lazy + opt-in** (mirrors the lazy-Firebase learning #3): zero config in dev/test/CI, no events shipped, nothing to stub.
- **`UsageLogService` best-effort** (degrade-don't-block): a logging-table write failure must not 500 the user's actual request.
- **Structured logs over stdout JSON** (not a transport/file): Cloud Run ingests stdout natively into Cloud Logging, reading `severity` + trace — no extra infra, matches "no full infra Day 1".
- Observability helper types left **un-exported** to satisfy knip (no consumer yet); re-export when M1+ imports them.

**Files changed:**
- `apps/api/src/observability/*.ts` (+ `*.test.ts`) — new module (7 source + 6 test files).
- `apps/api/src/app.module.ts` — import `ObservabilityModule`.
- `apps/api/src/main.ts` — Sentry init + structured logger + shutdown hooks.
- `apps/api/package.json` — `@sentry/node` 8.55.2 (exact-pinned).
- `jest.base.cjs` — worker memory caps.

**Notes for next iteration:**
- The DI graph (global module + middleware + APP_FILTER + Sentry) was validated by bootstrapping the built `dist/app.module` (`NestFactory.create` → `init` → `close`) with dummy creds — confirmed clean wiring + correct structured log output. Throwaway smoke, not committed.
- `RlsService` now has its **first real consumer** (`UsageLogService`). M1's ingestion/retrieval route should record usage via `UsageLogService.record(...)` and is the natural place to add the first `@nestjs/testing` module-level test (re-add the dep + knip ignore then).
- `costMicros` unit = millionths of a USD cent. Feeds Open Decision #4 (unit economics) + M10 analytics.

---

## P0.6 — Design system foundation (UI primitives + token guard)

**Date:** 2026-06-01

**What shipped**
- Added the remaining `packages/ui` React primitives over the ds.css class components: `Card`, `Chip`, `Cite`, `Field` (+ `Input`/`Select`/`Textarea`), `Table`, `Stat`, `Bar`, `Shell` (+ `Topbar`/`Content`). `Button`/`Badge`/`cx` already existed. All exported from `src/index.ts`.
- `Cite` enforces the citation-integrity rule structurally: defaults `resolved={false}` and returns `null` until resolved, so an unresolved marker is never flashed. `variant="upload"` renders the info-blue `.cite.upload` treatment; `knowledge` is crimson.
- `Bar` clamps + `Number.isFinite`-guards its `value` (directive #9).
- **Token guard wired into `pnpm lint`:**
  - Stylelint: `.stylelintrc.json` now sets `color-no-hex: true` + `unit-disallowed-list: ["px"]` globally, with a `**/ds.css` override exempting the token source-of-truth. Also disabled `declaration-block-single-line-max-declarations` + `color-hex-length` so ds.css passes stylelint-config-standard (these were the failures noted in the prior state). New root scripts: `lint:css` (stylelint over `packages/**/src/**/*.css` + `apps/**/app/**/*.css`), chained into `lint`.
  - ESLint: `no-restricted-syntax` rule banning anchored hex-color string literals (`^#([0-9a-fA-F]{3,4}|{6}|{8})$`) added to root `.eslintrc.json` and both app configs (`apps/web`, `apps/admin`).
- ds.css + Google Fonts were already imported at both Next.js app roots (no change needed).

**Verification**
- `pnpm build` (7/7), `pnpm typecheck` (10/10), `pnpm test` (ui cx 3/3, 100%), `pnpm lint` (7/7 + lint:css), `pnpm deadcode` (knip clean) — all green.
- Guards proven non-vacuous: a temp `.tsx` with `"#fff"` fails ESLint; a temp non-ds `.css` with `#abcdef` + `13px` fails stylelint (`color-no-hex` + `unit-disallowed-list`).

**Notes**
- Component `.tsx` files are intentionally not unit-tested: ui `jest.config.cjs` collects coverage only from `src/**/*.ts` (helpers), so the 90% gate stays on `cx.ts`. Component rendering is covered by app-level E2E later (M11).
- knip stays clean because `index.ts` is the package entry (its exports are the public API).

---

## M1.1 — Versioned expert-knowledge ingestion pipeline
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest M1.1 / §"Phased Delivery Roadmap" (M1) / §"Critical Files" (`packages/ai`, `apps/api/src/ingestion`)

**What was done:**
- Built the seed/CLI-loaded ingestion pipeline behind stable contracts: validate → parse → chunk → summarize → embed → persist as immutable `document_versions` + `chunks`.
- `packages/ai` (pure, offline, 100% cov): `chunkText`/`estimateTokens` (overlapping word-window chunker); `Summarizer` interface + `ExtractiveSummarizer` (deterministic default) + `LlmSummarizer` (LlmProvider-backed); `HashingEmbeddingProvider` (deterministic FNV-1a bag-of-words → L2-normalized 1536-dim vector, Unicode tokenizer covers Vietnamese). Added ordering+length guarantee JSDoc to the `EmbeddingProvider` contract.
- `packages/shared`: Zod `ingestionInputSchema` (sourceUri/title/scope/language/contentType/changeSummary) + `contentScopeSchema`/`languageSchema` (declared independently of `@expertos/db`, like `roleSchema`).
- `apps/api/src/ingestion`: `Parser` contract + `toText`; `TextParser` (plain/markdown) + `CsvParser` (RFC-4180 quoting → `header: value` records); `ParserRegistry` (normalizes MIME, throws `UnsupportedContentTypeError` — the seam where M5's PDF/XLSX parsers slot in); `DocumentVersionRepository` (find-or-create document by `(tenant,scope,sourceUri)`, append immutable version, write chunks, embedding via raw `UPDATE chunks SET embedding=$1::vector` with fixed-precision literal); `IngestionService` orchestrator (records `ingest.embed` usage, logs); `IngestionModule` (DI tokens for swappable embedder/summarizer); `ingest.cli.ts` manifest loader (`pnpm --filter @expertos/api ingest <manifest.json>`); `ingestion.defaults.ts` (shared default provider factories — one composition root for module + CLI).
- Wired `IngestionModule` into `AppModule`; added `@expertos/ai` dep to `apps/api`; registered the CLI as a knip entry; added `ingest` script.

**Key decisions:**
- **Offline-deterministic providers** (`HashingEmbeddingProvider`, `ExtractiveSummarizer`) as the M1.1 defaults: the sandbox has no network/API keys and the 90% coverage gate forbids untestable code paths. They're legitimate dev/seed drivers; the real OpenAI driver lands later behind the unchanged `EmbeddingProvider`/`Summarizer` contracts. Documented as the swap seam.
- **Publish-on-ingest by default** (version+chunks `published`, sets `Document.publishedVersionId`) so seeded knowledge is immediately retrievable for M1.2; `publish:false` leaves a draft for the M8 expert-review gate. Versioning keyed on `sourceUri` so re-ingesting appends a new immutable snapshot.
- **HTTP upload deliberately out of scope** (M5 does query-time upload, M8 the admin UI). M1.1 is CLI/seed only, matching the manifest.
- Persistence isolated in `DocumentVersionRepository` (the single `RlsService` DB choke point); the orchestrator stays DB-free and fully fakeable.

**Review (multi-agent workflow):** Ran a 3-dimension (correctness/security/design) review with adversarial per-finding verification. 11 raw findings → 3 confirmed:
- **HIGH (fixed):** `IngestionModule` injected `RlsService` (via the repo) but didn't `import: [AuthModule]`, and `AuthModule` isn't `@Global` → `UnknownDependenciesException` at bootstrap. Direct-construction unit tests never build the DI container so they missed it. Fixed + verified with a throwaway `createApplicationContext` smoke (`ctx.get(IngestionService)` resolves). → LEARNINGS #5.
- **LOW (fixed):** embedding/summary positional alignment relied on an undocumented provider guarantee → documented it on the interface + added an `embeddings.length === contents.length` guard (with test).
- **LOW (fixed):** CLI hand-wired the pipeline parallel to the module (drift risk) → extracted `ingestion.defaults.ts` shared by both.

**Files changed:**
- `packages/ai/src/ingestion/{chunk,summarize}.ts`, `packages/ai/src/embedding/hashing-embedding-provider.ts`, `packages/ai/src/providers.ts` (embed JSDoc), `packages/ai/src/index.ts` (+tests)
- `packages/shared/src/ingestion.ts`, `packages/shared/src/index.ts` (+test)
- `apps/api/src/ingestion/{parser,parser-registry,ingestion.tokens,ingestion.defaults,document-version.repository,ingestion.service,ingestion.module,ingest.cli}.ts`, `parsers/{text,csv}-parser.ts` (+tests)
- `apps/api/src/app.module.ts`, `apps/api/package.json`, `knip.json`

**Notes for next iteration:**
- **M1.2 (next):** the `VectorStore.query` pgvector driver — `$queryRaw` cosine-distance (`embedding <=> $1::vector`) over `chunks` filtered by `status='published'`, `tenant_id`, `scope`, `language` (HNSW index `chunks_embedding_idx` already exists). Embed the query with the same `HashingEmbeddingProvider` so dev retrieval is consistent end-to-end. This is the first reader of M1.1-ingested chunks — a good place to add an integration smoke once a DB is available.
- The CLI/repository can't be run end-to-end in this sandbox (Prisma library engine SIGILLs at query time — LEARNINGS #2; no DB). All pure logic is unit-tested; DB wiring verified via the bootstrap smoke.
- When the real embedding model is wired, override it in `ingestion.defaults.ts` **and** the `EMBEDDING_PROVIDER` token so the API and the CLI seed loader write into the same vector space; consider migrating the CLI to `NestFactory.createApplicationContext` for a single DI composition root.
- `approvedBy` is left null for system/CLI ingestion (no FK), set it to the expert's user id when the M8 review gate approves a version.

## M1.2 — Hybrid retrieval behind the VectorStore interface
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest M1.2 (§"Phased Delivery Roadmap" M1, §"Tenant/user isolation", §Architecture)

**What was done:**
- Evolved the `@expertos/ai` `VectorStore` contract from `query(embedding, topK)` to `retrieve(RetrievalRequest)` (no consumers existed yet, safe break). Added optional `vectorScore`/`keywordScore` to `RetrievedChunk` for transparency.
- Added a pure, DB-free **Reciprocal Rank Fusion** (`fuseHybrid`) in `packages/ai/src/retrieval/fusion.ts` that blends the vector + keyword ranked lists by position (RRF, default k=60, optional per-modality weights). Position-based fusion sidesteps the incomparable cosine-vs-`ts_rank` score scales — no normalization/blend-weight tuning. Deterministic (chunkId tiebreak). 7 unit tests.
- Added the retrieval value/filter/request types in `packages/ai/src/retrieval/types.ts`, kept dependency-free (string-literal unions mirroring the Prisma/shared enums).
- Added canonical zod validation in `packages/shared/src/retrieval.ts`: `chunkStatusSchema`, `retrievalFiltersSchema` (`status` defaults to `published`), `retrievalQuerySchema` (`text` trimmed/bounded, `topK` 1–50 default 8). 7 unit tests.
- `apps/api/src/retrieval/`: `PgVectorStore implements VectorStore` — thin `$queryRawUnsafe` driver: vector search via cosine `<=>` over the HNSW `chunks.embedding` index + keyword search via `websearch_to_tsquery`/`ts_rank` full-text over `content || summary` (`'simple'` config so Vietnamese isn't English-stemmed), both gated by bound-param metadata filters (`status`, optional `language`, optional `scope` via `= ANY($n::content_scope[])`); over-fetches `topK*4` (cap 200) per modality, then RRF-fuses. `RetrievalService` embeds the query (same provider as ingestion) and runs the store inside `RlsService.run` so tenant isolation is enforced by RLS (no `tenant_id` predicate in SQL). `RetrievalModule` wired into `AppModule`.
- Extracted the pgvector text-literal helper to `apps/api/src/database/vector.ts` (`toVectorLiteral`) and refactored `DocumentVersionRepository` to reuse it (was a private `formatVector`).

**Key decisions:**
- **RRF over weighted score fusion.** Cosine similarity (~[-1,1]) and `ts_rank` (small unbounded) live on different scales; RRF combines by rank so it needs no per-corpus normalization. Kept it as a pure function in `@expertos/ai` so it's fully unit-testable without a DB and reusable by M2 voice-example retrieval.
- **Driver receives an already-RLS-scoped `tx`, not the user.** Keeps the `VectorStore` interface app-auth-agnostic; `RetrievalService` owns `rls.run` and `new PgVectorStore(tx)` inside it. Tenant isolation stays structural (directive §4.21) — SQL never expresses `tenant_id`.
- **Filter vocabulary duplicated (ai local unions vs shared zod) on purpose.** `@expertos/ai` stays dependency-free (matches the ingestion code's purity); `RetrievalService` assigning shared's validated `filters` into ai's `RetrievalRequest` is the compile-time drift guard.
- **No HTTP controller.** Mirrors M1.1 (CLI/seam only). The chat layer (M3) and citation builder (M4) are the real consumers and don't exist yet; exposing an endpoint now would be untested surface.
- **`'simple'` text-search config** as the VI baseline for M1.3/OD#9 (no English stemming to distort Vietnamese; diacritics preserved on both sides).

**Files changed:**
- `packages/ai/src/providers.ts` — `VectorStore.retrieve(RetrievalRequest)`; `RetrievedChunk` component scores.
- `packages/ai/src/retrieval/{types,fusion}.ts` (+ `fusion.test.ts`), `packages/ai/src/index.ts` — new exports.
- `packages/shared/src/retrieval.ts` (+ `retrieval.test.ts`), `packages/shared/src/index.ts` — zod schemas.
- `apps/api/src/retrieval/{pgvector.store,retrieval.service,retrieval.module,retrieval.tokens}.ts` (+ store/service tests).
- `apps/api/src/database/vector.ts` (new) + `apps/api/src/ingestion/document-version.repository.ts` (reuse) + `apps/api/src/app.module.ts` (wire module).

**Notes for next iteration:**
- **Integration (M11):** the two raw queries aren't run against real pgvector here. Verify with Testcontainers: (1) `scope = ANY($n::content_scope[])` binds a JS `string[]` through `$queryRawUnsafe`; (2) `<=>` ordering + `ts_rank` return JS numbers. Add a GIN index on the `to_tsvector('simple', content||' '||summary)` expression for keyword perf when the corpus grows (currently per-row).
- **M1.3 / OD#9 (next):** decide language-filter vs cross-lingual retrieval and build the eval golden-set (needs OD#6). The `'simple'` keyword config + Unicode embedder are the baseline to measure against.
- **Same-model invariant:** retrieval and ingestion both build their embedder from `createDefaultEmbeddingProvider`. When the OpenAI driver lands, change that one factory; if they diverge, query/chunk vectors stop being comparable.

## M1.3 — Vietnamese retrieval quality (OD#9) + RAG eval harness
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest M1.3; §"Open Decisions" #9; §"Testing Strategy" (LLM/RAG eval harness)

**What was done:**
- **Root-caused and fixed a silent Vietnamese recall killer:** VI diacritics encode as NFC (precomposed, e.g. `"ệ"` = 1 code point) or NFD (decomposed base letter + combining marks). Combining marks carry Unicode property `Mark`, not `Letter`, so the `[\p{L}\p{N}]+` tokenizer breaks decomposed words apart (`"Việt"`→`["vie","t"]`, `"trưởng"`→`["tru","o","ng"]` — only 2 of 6 words survive in a real sentence). A query and a document in different normalization forms then share almost no tokens, destroying recall in **both** the vector path (hashing embedder) and the keyword path (Postgres `to_tsvector`). Verified empirically before fixing.
- **Fix: NFC-normalize at every text boundary.** New `@expertos/ai` `text.ts` exposes `normalizeText` (NFC) + `tokenize` (NFC → lowercased Unicode letter/number runs) as the *single* tokenizer definition; the embedder and chunker now both use it. New `@expertos/shared` `text.ts` `normalizeText`, applied as a `retrievalQuerySchema.text.transform(...)` so query text is NFC at the validation boundary (directive §1) — this covers the Postgres keyword path, which does not normalize.
- **Built a deterministic, DB-free RAG eval harness** in `@expertos/ai` `eval/`: `evaluateRetrieval(goldenSet, opts)` reuses the production primitives (chunk → embed → cosine + keyword-overlap → `fuseHybrid` RRF; candidate over-fetch + default topK mirror `PgVectorStore`) and computes recall@k / precision@k / MRR / hit-rate. Pure metrics in `metrics.ts` (all divisions guarded — directive §9).
- **Seeded `RETRIEVAL_GOLDEN_SET`** (12 docs / 7 cases): EN, VI (NFC), mixed EN-VI, and an NFD-query-vs-NFC-corpus regression case that passes only because normalization runs. Tests assert hitRate=1 over the curated set, NFD≡NFC ranked results, and an *intentional* cross-lingual miss with the lexical offline embedder (documents the policy boundary).
- **Resolved OD#9** in PRD with the decisions: cross-lingual/multilingual retrieval by default (optional `language` filter), mandatory NFC, VI-safe whitespace chunking (noting the EN-tuned token estimate under-counts VI), and the offline-vs-out-of-band eval split. Marked M1.3 + OD#9 done.

**Key decisions:**
- **NFC normalization placed at three boundaries, not one:** the pure `@expertos/ai` primitives (embedder/chunker) self-normalize for correctness regardless of caller; the shared schema normalizes query text for the Postgres keyword path that bypasses the embedder. Defense-in-depth, idempotent (NFC∘NFC = NFC).
- **`normalizeText` duplicated (one line) in `@expertos/ai` and `@expertos/shared`** rather than cross-importing — preserves the existing rule that `@expertos/shared` and `@expertos/ai` don't depend on each other (same reason their enums/types are mirrored). The body is a single canonical-form call; nothing to drift.
- **Eval harness lives in `@expertos/ai`, lexical/offline by design.** It guards tokenization/normalization/fusion deterministically in CI; semantic quality (true cross-lingual recall) is explicitly out-of-band with the real model via the same fixtures + the `embedder` option. The cross-lingual miss is asserted, not hidden — honest about what a lexical model can/can't do.
- **Single shared `tokenize`** for embedder + eval keyword scorer so they can't diverge; the eval keyword path is documented as the offline approximation of Postgres `'simple'` `ts_rank` (the real numbers are validated in the M11 Testcontainers eval).
- Cross-lingual default over a hard language filter: experts hold mixed EN-VI knowledge and the production embedder is multilingual; a hard gate would block EN knowledge from answering VI questions. `language` stays optional.

**Files changed:**
- `packages/ai/src/text.ts` (new) — `normalizeText` + `tokenize` (shared NFC tokenizer).
- `packages/ai/src/embedding/hashing-embedding-provider.ts` — use shared `tokenize` (removed private copy); doc updated.
- `packages/ai/src/ingestion/chunk.ts` — `words()` NFC-normalizes input; doc notes VI token-estimate under-count.
- `packages/ai/src/eval/{types,metrics,harness,golden-set}.ts` (new) — eval harness + seed golden set.
- `packages/ai/src/eval/{metrics,harness,golden-set}.test.ts`, `packages/ai/src/text.test.ts` (new) — 100% coverage.
- `packages/ai/src/index.ts` — export `evaluateRetrieval`, `RETRIEVAL_GOLDEN_SET`, eval types.
- `packages/shared/src/text.ts` (new) + `packages/shared/src/text.test.ts` (new) — boundary `normalizeText`.
- `packages/shared/src/retrieval.ts` — `text` field `.transform(normalizeText)`; `packages/shared/src/index.ts` exports it; `retrieval.test.ts` adds NFC assertion.
- `project-mds/PRD.md` — OD#9 resolution narrative + table + manifest checkboxes (M1.3, OD#9).

**Notes for next iteration:**
- **OD#6 (eval golden-set ownership/size/refresh) is now directly actionable** — the harness + seed fixtures exist; OD#6 just needs the named owner, per-expert/topic size targets, and the refresh-on-republish cadence. Recommend resolving it alongside M2.
- **M2.4 + M4 should extend this harness, not fork it:** add voice-fidelity (voice-on≈voice-off, per expert) and citation-resolvability assertions as new eval modes / golden-set fields.
- The offline harness can't measure semantic VI quality (lexical embedder). Wire the out-of-band run when the real OpenAI embedder driver lands (pass it via `evaluateRetrieval({ embedder })`); keep NFC normalization in that driver's tokenization too.
- Consider a GIN index on `to_tsvector('simple', content||' '||summary)` (M11) — still relevant; unaffected by this change.

## M2.1 — Expert voice layer: voice profiles + runtime voice-example retrieval + voice-on-top-of-facts prompt builder
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M2.1; §"Expert voice layer" (the differentiator — pulled into Phase 1); principle #5 "Voice is the product, separated from facts"

**What was done:**
- **`@expertos/ai` prompt builder (`prompt/`):** new pure, deterministic `buildAnswerPrompt(input)` returning `{ messages: ChatMessage[], citations: PromptFact[] }`. The system prompt encodes voice-on-top-of-facts as priority-ordered rules: (1) facts authoritative — answer ONLY from numbered SOURCES, never invent/alter/round/contradict; (2) cite everything with `[n]` markers limited to provided source numbers; (3) voice guidelines + style examples are presentation-only (tone/structure/framing), never a source of claims; (4) insufficient-knowledge → say so plainly, don't fill from memory; (5) answer language (EN default, VI supported). Renders "AI rendition of [Expert]" framing when a voice profile is present, omits it for neutral voice. Caps style examples at 5. NFC-normalizes query/facts/guidelines/examples (directive §36). `citations[i]` resolves marker `[i+1]` — the M4 resolvability contract. Exported from `packages/ai/src/index.ts`.
- **`apps/api/src/voice` runtime voice-example retrieval:** `PgVoiceExampleStore` — single-modality cosine over the HNSW `voice_examples.embedding` index (no keyword path → no fusion), with `loadProfile(expertId, language)` (published-profile + `e.active = true` gate) and `retrieveExamples({ voiceProfileId, embedding, topK })`; bound params, runs inside the caller's RLS-scoped tx (tenant isolation structural). `VoiceService.retrieveVoice(user, voiceQuery)` embeds the topic with the same provider as ingestion (`VOICE_EMBEDDING_PROVIDER` ← `createDefaultEmbeddingProvider`), resolves the profile + examples inside `RlsService.run`, usage-logs `voice.embed`, and returns `{ profile, examples, language }` (empty layer when no published profile). `VoiceModule` wired into `AppModule`.
- **`@expertos/shared` `voiceQuerySchema`:** `expertId` (uuid), `text` (trim/min/max + NFC transform), `language` (default `en`), `topK` (1–10, default 3). Exported + tested.
- Tests: ai 11 (prompt builder), shared 5 (voice schema), api 8 (store 3 + service 5). 100% coverage on all new code.

**Key decisions:**
- **Prompt builder lives in `@expertos/ai` (pure), not apps/api.** It's the single enforcement point for voice-vs-facts and must be unit/eval-testable without DI or a DB — same purity rule the retrieval/ingestion primitives follow. M2.4's separation tests assert against its output rather than re-implementing the rule.
- **Voice retrieval is a separate seam from knowledge retrieval (`VoiceService` vs `RetrievalService`).** Facts and voice are retrieved independently so voice can never substitute for a fact — mirrors the architectural separation. Single-modality (cosine only): voice matching is purely semantic, there's no keyword analogue, so no `fuseHybrid`.
- **Builder returns `citations` aligned to `[n]` markers** instead of leaving M4 to re-derive the mapping — guarantees every emitted marker resolves to a real chunk by construction.
- **No-profile → neutral-voice fallback** (empty voice layer) rather than erroring: a published profile may not exist in the requested language yet; facts must still be answerable.
- **Reused `createDefaultEmbeddingProvider`** (same factory as ingestion + knowledge retrieval) so voice-example vectors and the query topic share one model/space; production swaps one factory and all three move together.

**Files changed:**
- `packages/ai/src/prompt/types.ts` — new: prompt-builder value types (`PromptFact`, `VoiceProfileInput`, `VoiceExampleInput`, `AnswerPromptInput`, `AnswerPrompt`, `PromptLanguage`).
- `packages/ai/src/prompt/answer-prompt.ts` — new: `buildAnswerPrompt` (voice-on-top-of-facts system prompt + numbered sources + citation alignment).
- `packages/ai/src/prompt/answer-prompt.test.ts` — new: 11 tests (rule presence, citation alignment, voice/no-voice, VI, example cap, NFC, empty facts).
- `packages/ai/src/index.ts` — export the prompt builder + types.
- `packages/shared/src/voice.ts` + `voice.test.ts` — new: `voiceQuerySchema` + tests.
- `packages/shared/src/index.ts` — export `voiceQuerySchema` / `VoiceQueryInput`.
- `apps/api/src/voice/{voice.types,voice-example.store,voice.service,voice.tokens,voice.module}.ts` + `voice-example.store.test.ts` + `voice.service.test.ts` — new voice module.
- `apps/api/src/app.module.ts` — register `VoiceModule`.

**Notes for next iteration:**
- **M2.2 (multi-voice + disclosure)** is mostly UX: `VoiceService.retrieveVoice` already keys on `expertId` and the builder already emits "AI rendition of [Expert]". M2.2 needs the expert-selection UI, persisting which expert/voice answered, and surfacing the disclosure label in chat (UI renders the label; the builder deliberately does NOT append a disclaimer line).
- **Voice examples are not seeded/authored yet.** When adding a seed/admin authoring path (M8), embed `voice_examples.embedding` via `createDefaultEmbeddingProvider` or cosine match is meaningless. The store's cosine SQL is not exercised against real pgvector — add to the M11 Testcontainers pass (same as `PgVectorStore`).
- **M2.4** should extend the `@expertos/ai` `eval/` harness with voice-fidelity (voice-on≈voice-off per expert) + voice-vs-facts assertions that drive `buildAnswerPrompt` against a live LLM out-of-band; the offline harness can't judge tone.
- No new bug/learning surfaced — monorepo build-order (rebuild `@expertos/shared`/`@expertos/ai` before api typecheck sees new exports) is already known behavior.

## M2.2 — Multiple selectable expert voices + attribution / "AI rendition of [Expert]" disclosure
**Date:** 2026-06-01
**Ref:** PRD §"Expert voice layer" / Task Manifest M2.2

**What was done:**
- Added a pure, dependency-free attribution helper `@expertos/ai` `prompt/attribution.ts`: `buildAttribution(voice?) → { rendition, expertName?, disclosureText }`. The `"AI rendition of [Expert]"` phrase now lives ONLY here (single source of truth for prompt + UI).
- Refactored `buildAnswerPrompt` to embed `attribution.disclosureText` verbatim in the two places that previously hardcoded the phrase. Emitted strings are byte-identical, so `answer-prompt.test.ts` needed no changes and stays green (proves no drift).
- Exported `buildAttribution` + `AttributionInfo` from the `@expertos/ai` index for the future M3 chat UI to render the identical label.
- Added shared `expertListQuerySchema` (`language` optional, `limit` int 1..100 default 20) + `ExpertListQueryInput`, re-exported from `@expertos/shared` index.
- Added `apps/api/src/voice/expert.store.ts` `PgExpertStore.listExperts(language?, limit)`: raw SQL, bound params only, `array_agg(DISTINCT vp.language)` per expert, eligibility (`e.active = true` + `vp.status='published'`) enforced in SQL, RLS-scoped tx (no `tenant_id` predicate). Maps to new API-layer `ExpertVoiceMeta { expertId, displayName, languages[], hasActiveProfile:true }`.
- Added `VoiceService.listExperts(user, query)` — runs the store inside `RlsService.run`; no embedding/usage-record (no token-billed call); logs `expert voice list completed`.
- Tests: `prompt/attribution.test.ts` (5), `expertListQuerySchema` cases in shared `voice.test.ts` (4), `expert.store.test.ts` (3), `listExperts` cases in `voice.service.test.ts` (3). Counts 216→231; all new code 100% covered; `apps/api` 100% on gated services.

**Key decisions:**
- **Single source of truth for the disclosure phrase.** Rather than leave the literal in the prompt builder and re-type it in the UI later, centralized it in `buildAttribution` so the LLM framing and the visible label can never diverge. Kept emitted prompt strings identical to avoid churning existing tests.
- **Attribution lives in `@expertos/ai`, not the API.** It pairs with the prompt builder and is pure (consumes only `VoiceProfileInput`), preserving the package's Prisma/shared-free constraint.
- **No HTTP controller now (deferred to M3).** There is no UI or conversation persistence yet; M3's chat layer will call `listExperts`/`buildAttribution` in-process and own the route + the "which expert answered" persistence. Adding a controller now would be dead, un-E2E'd surface (the coverage gate only covers `*.service.ts`).
- **`language` optional with no default** in `expertListQuerySchema` (diverged from one survey suggestion of `default('en')`) so a picker can list ALL selectable experts; callers narrow when they need language-specific availability.
- **`limit` ceiling 100** (vs voice `topK` ≤10) since listing is not a few-shot crowding concern.

**Files changed:**
- `packages/ai/src/prompt/attribution.ts` — NEW pure helper + `AttributionInfo`.
- `packages/ai/src/prompt/answer-prompt.ts` — derive disclosure from `buildAttribution` (no string drift).
- `packages/ai/src/prompt/attribution.test.ts` — NEW (both branches, empty-name guard).
- `packages/ai/src/index.ts` — export `buildAttribution` / `AttributionInfo`.
- `packages/shared/src/voice.ts` — `expertListQuerySchema` + `ExpertListQueryInput`.
- `packages/shared/src/voice.test.ts` — list-schema defaults/bounds/rejection cases.
- `packages/shared/src/index.ts` — re-export the new schema + type.
- `apps/api/src/voice/voice.types.ts` — `ExpertVoiceMeta`.
- `apps/api/src/voice/expert.store.ts` — NEW `PgExpertStore`.
- `apps/api/src/voice/expert.store.test.ts` — NEW seam tests (mocked tx).
- `apps/api/src/voice/voice.service.ts` — `listExperts`.
- `apps/api/src/voice/voice.service.test.ts` — `listExperts` cases + harness `expertRows` branch.

**Notes for next iteration:**
- **M3 chat UI MUST render the "AI rendition" label from `buildAttribution`**, not a hardcoded string, or prompt-vs-label drift returns. Wording changes go in `attribution.ts` + `answer-prompt.test.ts` together.
- **Picker flow:** `VoiceService.listExperts` → user picks `expertId` → `VoiceService.retrieveVoice` → `buildAnswerPrompt({ voice, voiceExamples })`. `listExperts` only returns experts with a published profile, so the picker never offers a dead voice.
- **Persisting which expert answered** is intentionally NOT done — it lands on the message row in M3 when the conversation model exists; the answer path returns/derives attribution today.
- **`PgExpertStore` raw SQL is seam-tested only** (mocked tx): the `array_agg`→`text[]` mapping and the conditional `$1::language`/`LIMIT $n` param-position shift need the M11 Testcontainers pass (same policy as `PgVectorStore`/`PgVoiceExampleStore`).
- No new bug/learning surfaced; no LEARNINGS/DIRECTIVES change warranted.

## M2.3 — Expert sign-off workflow on own voice profile + language-aware voice (EN/VI)
**Date:** 2026-06-01
**Ref:** PRD §"Expert voice layer" / Task Manifest M2.3 (Phase 1)

**What was done:**
- Added the voice domain's **first write path**: `VoiceProfileService` (`apps/api/src/voice/voice-profile.service.ts`) — the publish-lifecycle state machine for voice profiles, run inside `RlsService.run` using Prisma Client model methods.
  - `create` (author a `draft`), `update` (edit free-text only while `draft`; `""` clears description/guidelines to NULL), `submit` (`draft→expert_review`), `approve`/sign-off (`expert_review→published`, stamps `approvedBy`=actor + `approvedAt`=now), `requestChanges` (`expert_review→draft`), `list` (sign-off queue / authoring list).
  - Invalid transition → 409 `ConflictException`; missing → 404; ownership fail → 403.
- Enforced the **ownership rule** (NT.2 — an expert signs off on their own voice): non-admin actor may only act on a profile whose `Expert.userId === user.id`; admin acts across the tenant. `list` auto-scopes non-admins to their own profiles. Enforced in `assertOwnership` (NOT RLS — `voice_profiles` RLS is tenant-only).
- New shared schemas (`packages/shared`): `publishStatusSchema` (new `publish.ts`, also serves the M8 knowledge gate) + `voiceProfileCreateSchema` / `voiceProfileUpdateSchema` / `voiceProfileListQuerySchema`. NFC-normalized text fields (directive §36), EN/VI, `limit` coerced for query strings.
- New `VoiceProfileController` (`POST /voice-profiles`, `PATCH /:id`, `POST /:id/{submit,approve,request-changes}`, `GET /`) — the first admin/expert-portal API surface — gated `@Roles("expert")` (admin satisfies via hierarchy), ownership enforced in the service.
- New reusable `ZodValidationPipe` (`apps/api/src/common/zod-validation.pipe.ts`), structurally typed so apps/api takes no `zod` dependency → 400 with field-level issues on bad input.
- Added `VoiceProfileSummary` to `voice.types.ts`; wired service+controller into `VoiceModule`.
- Tests: `voice-profile.service.test.ts` (19), `voice-profile.controller.test.ts` (4), `zod-validation.pipe.test.ts` (2), `publish.test.ts` (2), extended `voice.test.ts` (+11). All new code 100% coverage; gated `*.service.ts` = 100%.

**Key decisions:**
- **M2.3 vs M2.4:** picked M2.3 (the riskier, architectural item — first write path + ownership authz) over M2.4 (test-harness work, an easy win to save for later), per the priority order (architecture/integration first, fail fast on risk).
- **Prisma Client model methods, not raw SQL:** voice_profiles has no `Unsupported` column, so the write seam follows the `DocumentVersionRepository` pattern. Raw SQL stays confined to pgvector/`array_agg` reads.
- **Ownership in the service, not RLS:** `voice_profiles` RLS is `tenant_only`; the per-expert ownership rule is application-level (`assertOwnership`). Documented as a guardrail for future mutations.
- **Scope held to the sign-off workflow + minimal authoring (create/update of the *profile*).** Voice-*example* authoring with embeddings is left to M8.4; the full portal **UI** is M8.5. Added HTTP routes here (unlike M2.1/M2.2's deferred routes) because a sign-off action inherently needs an actor-facing endpoint.
- **`ZodValidationPipe` structurally typed** to avoid adding a `zod` dependency to apps/api (schemas live in `@expertos/shared`).
- **OD#3 (cold-start) not formally resolved** — took the pragmatic stance (author draft → submit → sign off) but left the product/expert template-vs-blank decision open.

**Files changed:**
- `packages/shared/src/publish.ts` (new) — `PUBLISH_STATUSES` + `publishStatusSchema`.
- `packages/shared/src/voice.ts` — voice-profile create/update/list schemas (+ shared NFC-normalized field helpers).
- `packages/shared/src/index.ts` — export the new schemas/types.
- `packages/shared/src/publish.test.ts` (new), `packages/shared/src/voice.test.ts` — schema tests.
- `apps/api/src/common/zod-validation.pipe.ts` (new) + `.test.ts` — reusable validator.
- `apps/api/src/voice/voice-profile.service.ts` (new) + `.test.ts` — workflow + authz.
- `apps/api/src/voice/voice-profile.controller.ts` (new) + `.test.ts` — HTTP surface.
- `apps/api/src/voice/voice.types.ts` — `VoiceProfileSummary`.
- `apps/api/src/voice/voice.module.ts` — register controller + service.

**Notes for next iteration:**
- **Any new voice-profile mutation MUST call `assertOwnership`/`loadManageable`** — RLS will not catch a peer-expert touching another's profile within the tenant.
- **Reuse `ZodValidationPipe`** for every future controller body/query; do NOT add zod to apps/api to type a schema.
- **Portal UI is M8.5**, **voice-example authoring is M8.4** — the API + `VoiceProfileSummary` (status/approvedBy/approvedAt) are ready for both.
- Prisma model writes are unit-tested with a mocked tx; same M11 Testcontainers caveat as the other stores (RLS WITH CHECK on insert, enum casts).
- No new bug surfaced; no LEARNINGS/DIRECTIVES change warranted (the zod-structural-typing choice is captured here + in progress-state notes).

## M2.4 — Voice-vs-facts separation tests + voice-fidelity assertion in the eval harness
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M2.4 (§"Expert voice layer", §"LLM/RAG eval harness"); Open Decisions #2, #3, #6. Finishes M2.

**What was done:**
- Added a dedicated voice-vs-facts separation test suite (`packages/ai/src/prompt/voice-vs-facts.test.ts`) asserting against `buildAnswerPrompt` output (the single enforcement point, never re-implementing the rule):
  - citation list identical with/without a voice, and identical across two different voices;
  - SOURCES+QUESTION user message byte-identical regardless of voice (voice lives only in the system message);
  - a number present ONLY in a voice guideline or style example (decoys "37%"/"7%") never leaks into the SOURCES block or the resolvable citation list;
  - all voice content confined to the system message;
  - facts-authoritative / voice-presentation-only / insufficient-knowledge rules survive even under a heavy (5-example) voice.
- Built a voice-fidelity eval harness mirroring the M1.3 retrieval harness's "deterministic-offline + out-of-band real model" split:
  - `eval/voice-types.ts` — `VoiceEvalCase`/`VoiceGoldenSet`, `VoiceJudge`/`VoiceJudgeRequest`/`VoiceJudgeVerdict`, `VoiceEvalOptions`, and the result/report types.
  - `eval/voice-metrics.ts` — pure `scoreStructural` (6 checks incl. the load-bearing facts-invariant-under-voice compare against a voice-off twin), `scoreLive`, `aggregate`, and the exported acceptance bars.
  - `eval/voice-harness.ts` — `evaluateVoice(goldenSet, { llm?, judge? })`. Structural layer always runs; live layer runs only when both `llm` + `judge` are injected (a `judge` without an `llm` throws).
  - `eval/voice-golden-set.ts` — `VOICE_GOLDEN_SET` (terse-EN-with-example, narrative-EN guidelines-only, VI-with-example).
- Exported the new surface from `packages/ai/src/index.ts`.
- Added test suites: `voice-metrics.test.ts` (17), `voice-harness.test.ts` (6), `voice-vs-facts.test.ts` (6) — using stub `LlmProvider`/`VoiceJudge` to exercise the live path deterministically in CI.

**Key decisions:**
- **OD#2 — engineering stance, not the product ruling.** Encoded acceptance bars in code: `FACT_ADHERENCE_BAR = 1.0` (any invented/altered claim fails a case outright — the product's premise is that facts stay authoritative) and `VOICE_FIDELITY_BAR = 0.7` mean (voice is a spectrum; leaves headroom for judge noise). The *product / expert-signed* bar and golden-set ownership/size/refresh (OD#6) stay open but now have a concrete harness to calibrate against. Documented both in the `voice-metrics.ts` doc comment.
- **Structural layer is the CI guard; live layer is out-of-band.** The structural checks are pure and assert the prompt contract — most importantly that building the same facts with vs. without the voice yields an identical user message + citation list. The live (real-LLM + judge) layer is a seam only, injected exactly like the M1.3 real-embedder slice, so CI stays deterministic and network-free.
- **No real judge implementation** — deliberately deferred (same policy as the real embedder). The interface + wiring exist; a real judge is implemented when product calibrates the bar.
- **Did NOT use a multi-agent workflow** despite the keyword being flagged: M2.4 is a single tightly-coupled test/harness authoring task in one package with shared design decisions — parallel agents would only risk conflicts. Implemented inline.

**Files changed:**
- `packages/ai/src/eval/voice-types.ts` — new: voice-fidelity eval contracts.
- `packages/ai/src/eval/voice-metrics.ts` — new: pure scoring + acceptance bars (OD#2).
- `packages/ai/src/eval/voice-harness.ts` — new: `evaluateVoice`.
- `packages/ai/src/eval/voice-golden-set.ts` — new: seed `VOICE_GOLDEN_SET`.
- `packages/ai/src/eval/voice-metrics.test.ts`, `voice-harness.test.ts` — new tests.
- `packages/ai/src/prompt/voice-vs-facts.test.ts` — new: voice-vs-facts separation tests.
- `packages/ai/src/index.ts` — export the new harness/types/bars.

**Notes for next iteration:**
- M2 is fully complete (M2.1–M2.4). Next is M3.1 (chat UI), which consumes `RetrievalService` + `VoiceService` + `buildAnswerPrompt`.
- To run the *semantic* voice-fidelity numbers, call `evaluateVoice(VOICE_GOLDEN_SET, { llm, judge })` out-of-band with a real `LlmProvider` and a `VoiceJudge` implementation (none exists yet — same deferral as the real embedder).
- M3.4's insufficient-knowledge path can lean on the prompt builder's already-enforced INSUFFICIENT-KNOWLEDGE rule.
- No bug surfaced; no LEARNINGS/DIRECTIVES change warranted. Coverage: whole `@expertos/ai` package at 100%.

## M3.1 — Chat UI with streaming + context-retaining follow-ups
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest Phase 1 M3.1; PRD §"Phase 1 — MVP" (Core Q&A loop: streaming responses, context-retaining follow-ups); Open Decisions #7 (engineering resolution) & #8 (interim deferral).

**What was done:**
- **`@expertos/ai` streaming contract:** extended `LlmProvider` with an *optional* `completeStream(messages) → AsyncIterable<LlmStreamChunk>` (kept `complete()` mandatory so the M2 voice-eval harness / `LlmSummarizer` are unaffected). Added `LlmStreamChunk` type. New offline deterministic `EchoLlmProvider` (`packages/ai/src/llm/echo-llm-provider.ts`) — the completion-side counterpart of `HashingEmbeddingProvider`: parses the built prompt's SOURCES/QUESTION, cites every numbered source, states INSUFFICIENT-KNOWLEDGE when there are no sources, no network/key; `completeStream` slices the same text so deltas concatenate to exactly `complete().text`. Exported both from the package index.
- **API chat module (`apps/api/src/chat/`):** `chat.tokens.ts` (`CHAT_LLM_PROVIDER`); `ConversationService` (RLS-scoped persistence — `loadHistory` capped at 10 msgs, `persistTurn` creates the conversation if new + writes user/assistant messages + ordinal-indexed citations in one transaction); `ChatService` (`answerStream` async generator wiring retrieval → voice → `buildAnswerPrompt` → history splice → LLM stream → persist → usage → terminal `done`; non-stream fallback when no `completeStream`); `ChatController` (`POST /chat` SSE over Express `@Res()`, `@Roles("user")`); `chat.module.ts` wired into `AppModule`.
- **Experts picker route:** new `ExpertsController` (`GET /experts`, any authenticated user) backed by `VoiceService.listExperts`, registered in `VoiceModule` — the first consumer of the M2.2 picker.
- **Shared:** new `packages/shared/src/chat.ts` — `chatRequestSchema` (NFC-normalized text, optional `conversationId`/`expertId`, `language` default en, `topK`) + `ChatMessageDto`/`ChatCitationDto`/`ChatStreamEvent` DTOs; re-exported from the shared index.
- **Web:** `apps/web/src/lib/chat-client.ts` (`streamChat` SSE-frame parser, `fetchExperts`, `renditionLabel`) + `apps/web/app/chat/page.tsx` (streaming chat UI, expert-voice picker, render-after-complete citations, "AI rendition of [Expert]" disclosure). Added `@expertos/shared` to web deps.
- **Composition root:** `createDefaultLlmProvider()` added to `apps/api/src/ingestion/ingestion.defaults.ts` (mirrors `createDefaultEmbeddingProvider` — swap the real LLM driver here).
- Tests: ai +6 (echo provider, 100%), shared +6 (chat schema, 100%), api +13 (chat.service 6 + conversation.service 6 + chat.controller 1) + experts.controller 1. Suite 298→323, all green; gated `*.service.ts` at 100%. Full Nest DI graph boot-smoked (create→init→close) with a valid-format dummy Firebase key — ChatModule + all providers resolve.

**Key decisions:**
- **SSE over raw Express response, not NestJS `@Sse()` or WebSockets** — `@Sse()` expects an RxJS Observable and ties the contract to message-events; a plain async generator + `res.write` keeps the orchestration trivially unit-testable without HTTP and matches the bootstrap (Express is the Nest default, no transport override in `main.ts`).
- **OD#7 (streaming vs citation-resolvability):** engineering resolution — stream only answer deltas; emit citations exactly once in a terminal `done` frame *after* generation AND persistence succeed, so a citation never flashes then vanishes. `prompt.citations` (the builder's list) is the single source of truth; never trust the model's emitted markers.
- **OD#8 (context-window/cost ceiling):** explicitly deferred to M3.5. M3.1 ships a hardcoded `HISTORY_LIMIT = 10` cap in `ConversationService.loadHistory` with a comment pointing at M3.5 for the token-budget/summarization replacement.
- **Optional `completeStream`** (not a breaking interface change) + a `ChatService` fallback to `complete()` — keeps every existing `LlmProvider` consumer valid and lets a future non-streaming driver work unchanged.
- **History layered at the app seam, not in `buildAnswerPrompt`** — prior turns are spliced between the builder's system message and the freshly built user message, so the prompt builder stays pure (voice-on-facts enforced) and the M2.4 separation tests keep asserting against unchanged builder output.
- **`renditionLabel` is a web-local one-liner**, not an import of `buildAttribution` — `@expertos/ai` is CommonJS (no tree-shaking), so importing it would pull the whole package (eval harnesses, golden sets) into the client bundle. Documented as a consolidation point.
- **Single-transaction turn persistence** (conversation + both messages + citations) so a mid-stream failure can't leave a user message without an answer; continuing a non-owned conversation throws 404 via RLS invisibility.

**Files changed:**
- `packages/ai/src/providers.ts` — `LlmStreamChunk` + optional `LlmProvider.completeStream`
- `packages/ai/src/llm/echo-llm-provider.ts` (+ `.test.ts`) — offline deterministic streaming LLM
- `packages/ai/src/index.ts` — export `EchoLlmProvider` + `LlmStreamChunk`
- `packages/shared/src/chat.ts` (+ `.test.ts`), `packages/shared/src/index.ts` — chat schema + DTOs
- `apps/api/src/chat/{chat.tokens,chat.service,conversation.service,chat.controller,chat.module}.ts` (+ service/controller `.test.ts`) — chat backend
- `apps/api/src/voice/experts.controller.ts` (+ `.test.ts`), `apps/api/src/voice/voice.module.ts` — picker route
- `apps/api/src/ingestion/ingestion.defaults.ts` — `createDefaultLlmProvider()`
- `apps/api/src/app.module.ts` — register `ChatModule`
- `apps/web/src/lib/chat-client.ts`, `apps/web/app/chat/page.tsx`, `apps/web/package.json` — web chat UI + `@expertos/shared` dep
- `project-mds/LEARNINGS.MD` — §2 nuance: `pnpm install` reverts the Prisma client to the library runtime; regenerate with `PRISMA_CLIENT_ENGINE_TYPE=binary npx prisma generate`.

**Notes for next iteration:**
- **M3.2** is the natural next step and the model/persistence already exist — add conversation list/get endpoints, auto-title from the first exchange (M3.1 leaves `Conversation.title` null), and saved-answer CRUD on `SavedAnswer`.
- **M3.4** insufficient-knowledge UI path can hang off the already-enforced behavior (zero sources → `EchoLlmProvider` + prompt builder both emit the insufficient answer); add 👍/👎 on `AnswerFeedback`.
- **No real LLM driver yet** (deliberate, mirrors the M1.3 real-embedder deferral): `EchoLlmProvider` is offline/deterministic. Wire the real driver in `createDefaultLlmProvider`; it should implement `completeStream` for true token streaming, else the `complete()` fallback is used (no streaming feel).
- **SSE controller is not coverage-gated** (only `*.service.ts` is) — the `chat.controller.test.ts` guards the framing with a fake `@Res()`; M11 E2E should exercise the real HTTP stream.
- After any `pnpm install`, re-run `cd packages/db && PRISMA_CLIENT_ENGINE_TYPE=binary npx prisma generate` or `pnpm test` SIGILLs (LEARNINGS §2).

---

## M3.2 — Conversation history + auto-titling + saved answers
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest Phase 1 §"Chat experience" / §"History & retention" (M3.2)

**What was done:**
- Extended `ConversationService` with the history read/write surface, built on the M3.1 persistence seam (no re-wiring):
  - `list(user, {limit, offset})` — the acting user's conversations as `ConversationSummaryDto[]`, ordered `updatedAt desc`; RLS scopes `conversations` to the owner so no `where` filter is needed for isolation.
  - `get(user, id)` — one conversation + its full user/assistant transcript (oldest-first); throws 404 when the conversation isn't the actor's (RLS makes a peer's row invisible → null → NotFound).
  - `rename(user, id, title)` — overrides the auto-title; ownership via `requireConversation` + RLS.
- **Auto-titling:** `persistTurn` now sets `title: deriveTitle(turn.userText)` on conversation create. `deriveTitle` is a pure, offline, deterministic helper — collapse whitespace, truncate on a word boundary at 80 chars with an ellipsis (hard-cut a single over-long word).
- New `SavedAnswerService` (bookmarks): `create` (bookmark an **assistant** answer — client passes only `messageId`; the owning conversation is derived server-side and ownership re-checked, since `messages` is `tenant_only` but `conversations` is `user_scoped`; 404 on missing/non-answer/unowned, 409 duplicate via the `(userId,messageId)` unique), `list` (RLS-scoped, newest-first), `remove` (404 when not the actor's, else delete).
- New thin controllers wired into `ChatModule`: `ConversationsController` (`GET /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id`) and `SavedAnswersController` (`POST /saved-answers`, `GET /saved-answers`, `DELETE /saved-answers/:id` → 204). Both `@Roles("user")`.
- New shared DTOs/schemas in `packages/shared/src/chat.ts` (exported from the index): `ConversationSummaryDto`, `ConversationDetailDto`, `conversationListQuerySchema`, `conversationRenameSchema`, `SavedAnswerDto`, `savedAnswerCreateSchema`, `savedAnswerListQuerySchema`. Pagination via `z.coerce`; lengths bounded per directive §1.1.
- Tests: `apps/api` +15 (conversation.service list/get/rename/auto-title incl. truncation + hard-cut branch; saved-answer.service full CRUD incl. ownership/duplicate paths). `@expertos/shared` +9 (new schema coverage in `chat.test.ts`). Both new services = 100% coverage.

**Key decisions:**
- **Auto-title derived, not LLM-generated.** PRD M3.2 says "meaningful title from first exchange" but doesn't mandate the method. Chose a deterministic string derivation over an LLM call: it's offline-safe with the `EchoLlmProvider`, adds zero token cost (aligned with the OD#8 cost concern), and is trivially testable. Rename endpoint covers the cases where the derived title is poor.
- **`messageId`-only bookmark with server-side conversation derivation** (directive §26). `messages` is `tenant_only` under RLS, so any tenant peer can read any message row; the `user_scoped` conversation lookup is the actual ownership boundary. Bookmarking a non-owned answer returns 404 (don't leak existence).
- **API + persistence only; web history UI deferred.** Mirrors the M2.3 precedent (voice-profile HTTP routes shipped before the M8.5 portal UI). Did NOT add web `chat-client.ts` helpers, since unused exports would fail knip before a UI consumes them.
- Kept controllers thin (apps/api coverage gate collects only `*.service.ts`) — all branchy logic in the services, validated via `ZodValidationPipe`.

**Files changed:**
- `packages/shared/src/chat.ts` — new conversation-history + saved-answer DTOs and zod schemas.
- `packages/shared/src/index.ts` — export the new schemas/types.
- `packages/shared/src/chat.test.ts` — tests for the four new schemas (defaults, coercion, validation).
- `apps/api/src/chat/conversation.service.ts` — `list`/`get`/`rename` methods, `deriveTitle` + auto-title on create, `toConversationSummary` + summary `select`.
- `apps/api/src/chat/conversation.service.test.ts` — list/get/rename + auto-title (collapse/truncate/hard-cut) tests.
- `apps/api/src/chat/saved-answer.service.ts` — new `SavedAnswerService` (create/list/remove).
- `apps/api/src/chat/saved-answer.service.test.ts` — new test suite.
- `apps/api/src/chat/conversations.controller.ts`, `apps/api/src/chat/saved-answers.controller.ts` — new controllers.
- `apps/api/src/chat/chat.module.ts` — register the two controllers + `SavedAnswerService`.
- `project-mds/PRD.md` — Task Manifest M3.2 `[ ]` → `[x]`.

**Notes for next iteration:**
- **M3.3 (full-text search)** should add a search method to `ConversationService` (or a sibling service) over `messages.content` (+ titles), scoped by RLS. Reuse the M1.2 keyword pattern: `to_tsvector('simple', content)` / `websearch_to_tsquery` (the `'simple'` config keeps Vietnamese undistorted — see the NFC-normalization directive §36); raw SQL is needed there for `ts_rank`. Consider a GIN index on the messages tsvector.
- **M3.4 (feedback)** can copy `SavedAnswerService` verbatim for `AnswerFeedback` — same `user_scoped` + `(userId,messageId)` unique + derive-conversation-from-message ownership shape; just add `helpful`/`reason`.
- The consumer-facing **web** history sidebar + saved-answers view is unbuilt — the API is ready; consume it from `apps/web/src/lib/chat-client.ts` when the UI lands (don't add helpers before then or knip fails).
- DB note unchanged: run api tests with `PRISMA_CLIENT_ENGINE_TYPE=binary` on this sandbox (LEARNINGS §2); the new tests mock the tx so they don't hit a real engine, but the suite as a whole loads the client.

## M3.3 — Full-text conversation search (message content + titles)
**Date:** 2026-06-01
**Ref:** PRD §"Chat experience" / Task Manifest M3.3

**What was done:**
- Added `ConversationService.search(user, {q, limit, offset})` (`apps/api/src/chat/conversation.service.ts`) — full-text search across the actor's conversations. A conversation matches when its title OR any user/assistant message matches a `websearch_to_tsquery('simple', $1)`. Ranked by the stronger of the title `ts_rank` and the best message hit, ties broken by `updatedAt desc`. Each hit carries a `ts_headline` snippet of its best-matching message (null when only the title matched).
- New shared `conversationSearchQuerySchema` (`q` trimmed / ≤200 / NFC-normalized — same boundary rule as `chatRequestSchema`; `z.coerce` pagination) + `ConversationSearchResultDto` (`{conversation, snippet, messageId}`) in `packages/shared/src/chat.ts`, exported from the index.
- New route `GET /conversations/search?q=` on `ConversationsController`, declared before `@Get(":id")` so the literal `search` segment isn't captured as a conversation id.
- New migration `20260601000000_conversation_search_indexes` — expression GIN indexes on `to_tsvector('simple', content)` (messages) and `to_tsvector('simple', coalesce(title,''))` (conversations).
- Tests: shared +4 (schema: defaults/normalize/coerce/bounds), api +3 (search: row-map + param-binding, title-only hit, empty). `conversation.service.ts` stays 100%.

**Key decisions:**
- **Raw SQL, in `ConversationService` (not a sibling service).** `ts_rank`/`ts_headline` have no Prisma Client expression — the same reason the M1.2 `PgVectorStore` keyword path is raw — so this is the first `$queryRawUnsafe` call in this service. Kept it co-located with the other conversation reads rather than spinning up a `ConversationSearchService`; the SQL + row mapper sit at the bottom of the file. The Client-method reads (`list`/`get`/`rename`) are unchanged.
- **Isolation via RLS, never a manual predicate.** The query joins `conversations` (`user_scoped`) to `messages` (`tenant_only`) inside `RlsService.run`; the intersection is exactly the actor's own messages, so the SQL expresses no `tenant_id`/`user_id` — identical posture to `PgVectorStore`.
- **`'simple'` text-search config** (no English stemming) keeps Vietnamese undistorted (OD#9), matching the retrieval keyword path; `q` is NFC-normalized at the schema boundary so a decomposed VI query still matches NFC-stored content.
- **Snippet is plain text, not HTML.** Configured `ts_headline` with `StartSel=«,StopSel=»` instead of the default `<b>…</b>` so the API never emits markup (directive §1 — a text-rendering client is XSS-safe). Documented on the DTO and in the service comment.
- **GIN indexes** matched verbatim to the query's `to_tsvector` expressions (the only way Postgres uses an expression index); `to_tsvector('simple', …)` resolves to the IMMUTABLE 2-arg form so it's indexable.

**Files changed:**
- `packages/shared/src/chat.ts` — new `conversationSearchQuerySchema` + `ConversationSearchResultDto`.
- `packages/shared/src/index.ts` — export the new schema + types.
- `packages/shared/src/chat.test.ts` — `conversationSearchQuerySchema` tests (+4).
- `apps/api/src/chat/conversation.service.ts` — `search` method, `ConversationSearchRow` type, `SEARCH_SQL`, `toConversationSearchResult`.
- `apps/api/src/chat/conversation.service.test.ts` — `$queryRawUnsafe` mock + 3 search tests.
- `apps/api/src/chat/conversations.controller.ts` — `GET /conversations/search` (before `:id`).
- `packages/db/prisma/migrations/20260601000000_conversation_search_indexes/migration.sql` — GIN indexes.

**Notes for next iteration:**
- **Seam-tested only.** The `ts_rank`/`ts_headline`/LATERAL query and GIN-index usage are not exercised against real pgvector here (mocked `$queryRawUnsafe`) — they join the M11 Testcontainers list alongside `PgVectorStore`/`PgExpertStore`. Worth verifying there: the LATERAL `best` subquery returns one row per conversation, the guillemet `ts_headline` selectors render, and the indexes are actually chosen by the planner.
- **Web search UI is unbuilt** (API only, mirroring M3.2). When it lands, HTML-escape the snippet as text (then optionally restyle the `«»` markers) — do NOT `dangerouslySetInnerHTML` it.
- **M3.4 (feedback)** is still the next obvious task — copy `SavedAnswerService` for `AnswerFeedback` (same `user_scoped` + `(userId,messageId)` unique + derive-conversation-from-message ownership).
- DB note unchanged: run api tests with `PRISMA_CLIENT_ENGINE_TYPE=binary` on this sandbox (LEARNINGS §2), or regenerate the client with the binary engine after a `pnpm install` (`cd packages/db && PRISMA_CLIENT_ENGINE_TYPE=binary npx prisma generate`).

---

## M3.4 — Insufficient-knowledge path + answer feedback (👍/👎 + reason)
**Date:** 2026-06-01
**Ref:** PRD §"Chat experience" / Task Manifest M3.4

**What was done:**
- **Insufficient-knowledge signal:** added `insufficientKnowledge: boolean` to the terminal `done` frame of `ChatStreamEvent` (`packages/shared/src/chat.ts`). `ChatService.answerStream` sets it to `facts.length === 0` — the deterministic, server-side proxy for "the prompt builder's INSUFFICIENT-KNOWLEDGE rule governed this answer" (the `EchoLlmProvider` already emits the no-sources answer). The turn is still persisted (it is a real answer) with empty `sourceVersionIds`.
- **Answer-feedback CRUD** on the pre-existing `answer_feedback` model (`user_scoped`, unique `(userId,messageId)`):
  - `AnswerFeedbackService` (`apps/api/src/chat/answer-feedback.service.ts`): `submit` (idempotent upsert — flip 👍↔👎 / revise reason) + `remove(user, messageId)` (retract). Ownership copied from `SavedAnswerService`: `messageId`-only → require `role:"assistant"` (404) → `user_scoped` `conversation.findUnique` is the real boundary (404). No `tenant_id`/`user_id` predicates (RLS does it).
  - `AnswerFeedbackController` (`POST /answer-feedback`, `DELETE /answer-feedback/:messageId` → 204), `@Roles("user")`, `ZodValidationPipe(answerFeedbackSubmitSchema)`; wired into `ChatModule`.
  - Shared `answerFeedbackSubmitSchema` + `AnswerFeedbackDto`/`AnswerFeedbackSubmitInput` (exported from `packages/shared` index).
- Tests: `answer-feedback.service.test.ts` (7 cases, 100% coverage), a new insufficient-knowledge case in `chat.service.test.ts`, `answerFeedbackSubmitSchema` accept/reject in `chat.test.ts`, and the `done`-fixture/assertion updates in `chat.controller.test.ts` + `chat.service.test.ts` for the new required field.

**Key decisions:**
- **Upsert, not create-or-409** (the deliberate divergence from the bookmark template): feedback is a mutable verdict, so re-submitting updates the row and clears `reason` to null when omitted, rather than conflicting. Better UX than forcing delete+recreate to change a thumb.
- **Insufficient-knowledge = retrieval-side `facts.length === 0`, not a model/confidence signal.** Deterministic and available today with the echo provider. Flagged in notes that a future real LLM could be insufficient *with* sources — revisit then.
- **API + persistence only; no web UI** — same precedent as M3.2/M3.3 (no unused web exports → knip stays clean).
- `insufficientKnowledge` made a **required** field on the `done` variant (only one producer, `ChatService`), so the web mirror can't silently forget it; updated the two test fixtures that build a `done` literal.

**Files changed:**
- `packages/shared/src/chat.ts` — `insufficientKnowledge` on `done` event; `answerFeedbackSubmitSchema` + `AnswerFeedbackDto`/`AnswerFeedbackSubmitInput`.
- `packages/shared/src/index.ts` — export the new schema + types.
- `packages/shared/src/chat.test.ts` — `answerFeedbackSubmitSchema` tests.
- `apps/api/src/chat/chat.service.ts` — emit `insufficientKnowledge` on `done`.
- `apps/api/src/chat/answer-feedback.service.ts` — new service (upsert + retract, ownership re-check).
- `apps/api/src/chat/answer-feedback.controller.ts` — new thin controller.
- `apps/api/src/chat/chat.module.ts` — register controller + service.
- `apps/api/src/chat/answer-feedback.service.test.ts` — new (7 cases).
- `apps/api/src/chat/chat.service.test.ts` — insufficient-knowledge case + assertion.
- `apps/api/src/chat/chat.controller.test.ts` — `done` fixture gains the field.

**Notes for next iteration:**
- **M3.5 closes M3** — replace the interim `HISTORY_LIMIT = 10` in `conversation.service.ts` with a token-budget/summarization policy (OD#8). Nothing else in M3 is open code-wise.
- **No web UI** for feedback or the insufficient-knowledge next-step — deferred with M3.2/M3.3's history/search/saved-answer UI. Consume via `apps/web/src/lib/chat-client.ts`.
- **M8.3 admin inspector** will add the admin-side read over `answer_feedback`; the service intentionally exposes only user-scoped submit/remove for now.
- DB note unchanged: run api tests with `PRISMA_CLIENT_ENGINE_TYPE=binary` on this sandbox (LEARNINGS §2).

## M3.5 — Conversation context-window / cost ceiling policy (Open Decision #8)
**Date:** 2026-06-01
**Ref:** PRD M3.5 / §"Open Decisions" #8 / §"Chat experience". Closes M3.

**What was done:**
- Retired the interim `HISTORY_LIMIT = 10` message cap (M3.1) in `ConversationService.loadHistory` and replaced it with a **token-budget window**: the most-recent user/assistant messages whose combined estimate fits `HISTORY_TOKEN_BUDGET = 1500`, with a hard `HISTORY_MAX_MESSAGES = 40` row-read backstop.
- Reused `estimateTokens` from `@expertos/ai` (the same word→token heuristic that sizes ingestion chunks) so windowing is deterministic, offline, and adds zero LLM cost.
- Wrote the full OD#8 resolution into the `HISTORY_TOKEN_BUDGET` doc comment (4 decisions + deferred-summarization seam) and into PRD §"Open Decisions" #8 as a RESOLVED block; updated the manifest (`[x] M3.5`, `[x] OD#8`, M3 heading → COMPLETE, OD#8 table row → ✅ RESOLVED).
- Added 2 `loadHistory` tests: token-budget windowing (two ~600-token messages fit, third dropped) and always-keep-the-single-most-recent (one over-budget message still carried).

**Key decisions:**
- **Budget by estimated tokens, not message count.** Ten short vs ten long messages cost very differently; token-bounding is what actually caps prompt size and per-answer spend. A message-count cap (the M3.1 interim) doesn't.
- **Whole messages, newest-first, always ≥ the latest message.** Never half a turn; the single most-recent message is always carried (the `windowed.length > 0` guard) so an immediate follow-up never loses its antecedent. Chose message-level (not turn-level) windowing for simplicity — the oldest kept message can be an assistant reply whose question fell outside the window, which still reads as coherent context.
- **Deterministic/offline, reusing the existing token estimator.** Matches the `deriveTitle` precedent (no LLM, no cost) and keeps a single tokenizer definition that the real tokenizer can later replace in one place.
- **Summarization deferred, not built.** Truncation is the M3.5 policy. Documented the seam: if LLM summarization lands it must use a cheap model and must NOT summarize away a concierge "inject corrected answer into context" edit (M9). Already M9-safe today because the window keeps the most-recent turns, where a correction enters as recent context.

**Files changed:**
- `apps/api/src/chat/conversation.service.ts` — added `estimateTokens` import; replaced `HISTORY_LIMIT` with `HISTORY_TOKEN_BUDGET`/`HISTORY_MAX_MESSAGES` + the full OD#8 policy doc comment; rewrote `loadHistory` to accumulate whole messages within the token budget (newest-first, always-keep-latest) before reversing to chronological.
- `apps/api/src/chat/conversation.service.test.ts` — renamed the cap test, updated `take` expectation to 40, added token-budget-windowing and always-keep-latest tests.
- `project-mds/PRD.md` — manifest `[x] M3.5` + `[x] OD#8`; M3 heading → COMPLETE; OD#8 table row → ✅ RESOLVED; added the RESOLVED block to §"Open Decisions" #8.

**Notes for next iteration:**
- **M3 is fully complete (M3.1–M3.5).** Next is **M4.1** — citation builder with chunk-resolvability guarantee, resolving `[n]` markers against `prompt.citations` (already carried on the `done` SSE frame as `ChatCitationDto[]`, `ordinal=i+1`); never trust the model to emit an out-of-range marker.
- `HISTORY_TOKEN_BUDGET` bounds only the *replayed history* portion of the prompt — the system message, freshly-retrieved facts, and the new user message are separate and not bounded by it. Re-tune in one place if cost/quality calibration needs it.
- Windowing is seam-tested with a mocked tx (the message rows are fixtures); no DB-backed exercise of the actual `createdAt desc` ordering — joins the M11 Testcontainers list with the other raw/DB-coupled paths.
- DB note unchanged: run api tests with `PRISMA_CLIENT_ENGINE_TYPE=binary` on this sandbox (LEARNINGS §2). (This run's gates all passed via `pnpm` without needing it for the mocked unit tests.)

## M4.1 — Citation builder with chunk-resolvability guarantee
**Date:** 2026-06-01
**Ref:** PRD §"Citations" / Task Manifest M4.1 (starts M4)

**What was done:**
- New pure, deterministic `@expertos/ai` module `packages/ai/src/prompt/citations.ts` exporting `buildCitations({ answer, citations }) → { text, citations }` plus `CitationSource`/`ResolvedCitation`/`BuildCitationsInput`/`BuiltCitations`. It is the single enforcement point for the M4 contract "never emit an unresolvable citation": parses every `[n]` marker in the COMPLETE post-stream answer, drops any marker outside `1..N` from both the returned text and the citation list, returns only the referenced sources (de-duped, ascending by ordinal) without renumbering, and returns the answer text with unresolvable markers stripped + whitespace squeezed.
- Co-located `citations.test.ts` (14 cases): adjacent/comma/space marker grammar, referenced-only + no-renumber (lone `[2]` stays ordinal 2), out-of-range `[0]`/`[99]` dropped + stripped, non-numeric `[abc]`/array-literal brackets left literal, `[1]-[3]` range as two markers, duplicate-source de-dup, mixed-group verbatim, empty source table, marker-free answer unchanged, `kind` default/preserve, NFC normalization, idempotence.
- Wired into `ChatService.answerStream` (`apps/api/src/chat/chat.service.ts`): after the stream completes, `buildCitations({ answer, citations: prompt.citations })` → persist `built.text` + `built.citations`, derive `sourceVersionIds` from cited sources, emit referenced-only `ChatCitationDto[]` on the `done` event (via the new single-item `toCitationDto`, replacing `toCitationDtos`). Added a `chat citations filtered` observability log when cited < retrieved. `insufficientKnowledge` left as `facts.length === 0` (decoupled from citation filtering).
- Exported `buildCitations` + its types from `packages/ai/src/index.ts`. Updated `chat.service.test.ts`: the streaming stub now emits `[1][2]` (parametrized `deltas`), main-test text/persisted-content updated to `"Answer [1][2]."`, plus a new test asserting an unresolvable `[9]` is dropped from citations and stripped from the persisted answer.
- Approach was chosen via a design workflow (parallel seam-map of API/web/`@expertos/ai`/forward-compat → 2 independent design proposals → synthesis).

**Key decisions:**
- **Referenced-only over emit-all:** the prior `toCitationDtos(prompt.citations)` listed every retrieved chunk as a source even when the answer never cited it (overstating grounding). The builder now emits only what a surviving resolvable marker referenced. Cost: a one-fixture change to `chat.service.test.ts` (intended).
- **Keep-ordinal over renumber:** the streamed delta prose already showed literal `[n]` tokens and the `done` event carries no text field, so renumbering would desync the list from the prose. Kept `ordinal === marker` (possibly non-contiguous); M4.2 owns gap-free 1..k *display*.
- **No `done`-event text field; persist `built.text`:** honors "never emit an unresolvable citation" for the history read path without a wire-contract change (OD#7-consistent: stream raw prose, finalize at done).
- **No change to `answer-prompt.ts` / `echo-llm-provider.ts`:** the builder parses the model ANSWER, not the SOURCES block, so the `[n]` grammar in SOURCES is untouched and the echo provider stays in lockstep (it emits all-in-range markers → referenced-only yields all N with natural ordinals).
- **`kind` reserved internally, not on the wire:** `ResolvedCitation.kind` ("knowledge"|"upload", default knowledge) reserves the M5 upload-citation concept; the `ChatCitationDto` wire field is deferred to M4.2/M5 with its `.cite`-variant consumer (avoids an unconsumed optional field tripping knip).
- **Whitespace squeeze kept minimal** (collapse runs of spaces, drop a space before sentence punctuation; never touches newlines) to limit surprising text diffs when a marker is removed.

**Files changed:**
- `packages/ai/src/prompt/citations.ts` — NEW pure builder + types.
- `packages/ai/src/prompt/citations.test.ts` — NEW 14-case unit test.
- `packages/ai/src/index.ts` — export `buildCitations` + the four citation types.
- `apps/api/src/chat/chat.service.ts` — call `buildCitations`; persist sanitized text + referenced-only citations; `sourceVersionIds` from cited sources; referenced-only `done` citations; `toCitationDtos`→`toCitationDto`; filtered-count log.
- `apps/api/src/chat/chat.service.test.ts` — parametrized `deltas`, marker-emitting stub, updated assertions, new unresolvable-marker test.

**Notes for next iteration:**
- **Next is M4.2/M4.3** (sources drawer + click-to-passage + provenance; resolve OD#7 Eng+Design sign-off). The `done` event already carries referenced-only citations with true marker ordinals; `apps/web/app/chat/page.tsx` already renders them post-stream via `<Cite>`.
- **Persisted-ordinal caveat:** `ConversationService.persistTurn` stores each citation row's `ordinal` as its loop index `i+1`, which diverges from the true marker ordinal for a filtered non-contiguous list. Harmless today (no read path re-hydrates citation ordinals; the wire DTO carries the true ordinal). When M4.2 adds a citation read path, persist/carry the true marker ordinal (pass an explicit ordinal into `persistTurn` or store `ResolvedCitation.ordinal`).
- **Mixed comma-group `[1,99]`** is kept verbatim when any member resolves (the out-of-range `99` stays visible in that rare form); the citation list never includes it. The echo provider emits separate `[n]` brackets so this is a real-LLM edge only.
- All gates green via `pnpm` (typecheck/test/lint/build/knip); the mocked unit tests didn't need `PRISMA_CLIENT_ENGINE_TYPE=binary` (LEARNINGS §2 still applies to any Prisma-Client-backed run).

## M4.2 — Sources drawer + click-to-passage + document_version_id provenance
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M4.2 (§"Design System", §"Citations")

**What was done:**
- Promoted `kind: "knowledge"|"upload"` from the internal `ResolvedCitation` onto the wire `ChatCitationDto` (now it has a consumer). `ChatService.toCitationDto` sets it on the `done` event.
- Fixed the M4.1-flagged persisted-ordinal bug: `TurnCitation` now carries `ordinal`, `chat.service` passes `c.ordinal`, and `ConversationService.persistTurn` writes the **true marker ordinal** instead of the loop index — a sparse citation list (lone `[2]`) now stores ordinal 2.
- Added the citation read path: `ChatMessageDto` gains required `citations: ChatCitationDto[]`; `ConversationService.get` re-hydrates them via a new private `loadCitations(tx, assistantMessageIds)` (single `citation.findMany`, grouped by message, ascending by ordinal), deriving `kind` from `uploadChunkId` presence and coalescing the shared nullable id columns to `""`.
- Web `AssistantAnswer` component (`apps/web/app/chat/page.tsx`): renders answer prose with `[n]` markers as clickable `.cite` chips **only after the stream completes and the marker resolves** (render-after-resolve); below it a sources drawer lists each resolved source with quote + `document_version_id` provenance; clicking an inline marker highlights + `scrollIntoView`s the matching `.source` row (click-to-passage), keyboard-accessible.
- New `.sources`/`.source`/`.source.active` design-system styles in `packages/ui/src/ds.css` (token-only; crimson active highlight via `--red-300`/`--red-50`/`--sh-focus`).
- Tests: +3 net in `apps/api` (persist-true-ordinal sparse list; `get` re-hydrates citations with derived `kind`; upload-kind + null-quote read path; empty-assistant skip-lookup). `conversation.service.ts`/`chat.service.ts` back to 100%.

**Key decisions:**
- **Built the read path now, not just the live drawer.** It makes the persisted-ordinal fix testable end-to-end and gives the (not-yet-built) M3.2 history UI the same sources drawer for free via `ConversationDetailDto.messages[].citations`. API-first is the established precedent (M2.3/M3.2–3.4).
- **Derive `kind` from `uploadChunkId`, no new column.** The `citations` table already has `chunk_id` vs `upload_chunk_id`; deriving `kind` on read is forward-compatible with M5 and avoids a migration. Nullable id columns coalesce to `""` (knowledge rows are always non-null; the guard only matters for the M5 upload shape).
- **Render-after-resolve enforced in the web component, not the data.** `built.text` (persisted) already strips unresolvable markers, but the *live* `m.content` is the raw stream; `renderAnswer` only upgrades a `[n]` to a live `.cite` when `done` AND the ordinal resolves, so a hallucinated `[9]` shown mid-stream degrades to plain text rather than a fake source. This is the structural realization of OD#7.
- **Styles went into `ds.css`** (the design-system home, exempt from the hex/px lint) rather than an app-local CSS file — keeps tokens centralized and reusable by the admin/history drawers; the `Sources` heading reuses the existing global `.label`.

**Files changed:**
- `packages/shared/src/chat.ts` — `ChatCitationDto.kind` added; `ChatMessageDto.citations` added (required array).
- `apps/api/src/chat/chat.service.ts` — `toCitationDto` sets `kind`; persistTurn citations now carry `ordinal`.
- `apps/api/src/chat/conversation.service.ts` — `TurnCitation.ordinal`; persistTurn writes the true ordinal; `get` re-hydrates citations; new `loadCitations` helper; `ChatCitationDto` import.
- `apps/api/src/chat/conversation.service.test.ts` — sparse-ordinal persist test; `get` citation re-hydration + upload-kind/null-quote + empty-assistant tests; `makeTx` gains `citation.findMany`.
- `apps/api/src/chat/chat.service.test.ts` — `kind: "knowledge"` locked into the done-event assertion.
- `apps/web/app/chat/page.tsx` — `AssistantAnswer` component, `renderAnswer` marker→cite renderer, sources drawer, click-to-passage.
- `packages/ui/src/ds.css` — `.sources`/`.source`/`.source.active` + a `.cite[role="button"]` reset.

**Notes for next iteration:**
- **M4.3 is a sign-off, not code.** The OD#7 engineering behavior is fully built (deferred citations → resolvability guarantee → render-after-resolve UI). What remains is the Eng+Design review verdict onto this behavior.
- **M5 upload-citation seam is pre-wired:** `ChatCitationDto.kind` + `loadCitations`'s `uploadChunkId ? "upload" : "knowledge"` derivation + the `.cite.upload` / `.source` styles already exist. M5 just needs to persist `uploadChunkId` and surface info-blue.
- **Web has no jest** (`passWithNoTests`) — the `AssistantAnswer`/`renderAnswer` UI is covered by typecheck/lint/build only; a Playwright path for click-to-passage joins the M11.1 E2E matrix.
- **Provenance is currently a text line** (`source: <document_version_id>`); a real click-to-open-document deep link wires off `documentVersionId` + `chunkId` when the M8 knowledge viewer exists.

## M4.3 — Resolve Open Decision #7 (streaming vs citation-resolvability UX)
**Date:** 2026-06-01
**Ref:** PRD §"Open Decisions" #7; §"Design System"; Task Manifest M4.3 (closes M4)

**What was done:**
- Resolved Open Decision #7 by documenting the Eng + Design sign-off onto the behavior already built across M3.1 → M4.1 → M4.2. **No code change** — this is a decision/review task (same pattern as OD#8/M3.5 and OD#9/M1.3, which were resolved by writing a `> RESOLVED` block into the PRD).
- Verified the actual engineering behavior before writing the resolution (did not trust the seam notes blindly): `apps/web/app/chat/page.tsx` `renderAnswer` gates `[n]` → clickable `.cite` on `resolved = message.done && message.citations.length > 0` (markers stay plain text mid-stream); click-to-passage via `focusSource` + `.source.active`; server-side `buildCitations` (M4.1) is the single resolvability enforcement point on the complete post-stream answer.
- Added a 5-point `> RESOLVED (M4.3)` block under PRD §"Open Decisions" #7 capturing: (1) stream prose / defer markers + the placeholder behavior (literal `[n]` text, no provisional chip); (2) resolvability enforced once server-side on the complete answer; (3) render-after-resolve also applies to re-hydrated history; (4) click-to-passage chosen over hover-preview (identical live vs. history, keyboard-accessible); (5) the key finding that streaming-feel and integrity do not actually conflict under deferral — no buffering trade-off.
- Marked the decisions-table row #7 as ✅ RESOLVED (M4.3), flipped M4.3 + OD#7 to `[x]` in the Task Manifest, and marked the `#### M4 — Citations` heading `— COMPLETE`.

**Key decisions:**
- **Confirmed the PRD's "likely resolution" rather than re-opening it.** The deferral approach was already the structural basis of M3.1/M4.1/M4.2; resolving the decision onto it (vs. proposing a mid-stream-citation alternative) avoids invalidating three shipped milestones and matches how the code already behaves.
- **Click-to-passage over hover-preview** documented as the resolved interaction because it gives an identical experience on the live turn and in re-hydrated history and works without pointer hover (accessibility).
- **Treated this as documentation-only.** Since no source files changed, the build/test/lint/deadcode status is unchanged from the 384-pass baseline; running the full suite would only re-confirm it.

**Files changed:**
- `project-mds/PRD.md` — added `> RESOLVED (M4.3)` block under Open Decision #7; decisions-table row #7 → ✅ RESOLVED; Task Manifest M4.3 + OD#7 → `[x]`; `#### M4 — Citations — COMPLETE`.
- `project-mds/progress-state.md` — added M4.3 to Completed; updated Next tasks to M5 (document uploads) as the next code milestone; M4 now COMPLETE.
- `project-mds/progress-log.md` — this entry.

**Notes for next iteration:**
- **M4 is fully closed.** The next code milestone is **M5 (document uploads)** — start at M5.1 (query-time upload + file-type/size validation + malware scan). The M1.1 `Parser`/`ParserRegistry` has the `UnsupportedContentTypeError` seam for PDF/DOCX/XLSX waiting to be filled.
- **M5 upload-citation seam is already wired** (from M4.2): persist `uploadChunkId` and `loadCitations` derives `kind: "upload"`; surface info-blue `.cite.upload` / `badge-info` per §"Design System" M5.4. No DTO change needed.
- **Remaining Phase-0 Open Decisions** (#1, #3, #4, product halves of #2/#6) are still open and can be resolved in parallel; #4 (unit economics) blocks the M6 seed quota matrix.
- **OD#7 has no follow-up code.** If a future real LLM ever emits trustworthy mid-stream citation grammar, the deferral default can be revisited (noted in the resolution block), but nothing is owed today.

## M5.1 — Query-time document upload with file-type/size validation + malware scan
**Date:** 2026-06-01
**Ref:** PRD M5.1 (Task Manifest); §"Document-assisted Q&A"; §"Security" (input safety: file-type/size validation + malware scan); directive §1.2 (filename sanitization)

**What was done:**
- New `apps/api/src/uploads/` module — the first multipart file-upload route in the codebase. Wired `UploadModule` into `AppModule`.
- `UploadService.upload(user, filePart, {conversationId?})` — the validate→scan→store→persist pipeline (the only coverage-gated file):
  - size guard (empty → 400; > 10 MiB `MAX_UPLOAD_BYTES` → 413, before any work)
  - MIME allowlist via `UPLOAD_TYPES` (txt/md/csv/pdf/docx/xlsx) → unsupported = 415
  - anti-spoof: filename extension must match the declared type (400); binary formats magic-byte sniffed (`%PDF`; `PK` ZIP header for OOXML xlsx/docx) → 400
  - malware scan behind `MalwareScanner` (offline `SignatureMalwareScanner` flags EICAR) → unclean = 422, never stored, warn-logged with signature
  - storage behind `StorageProvider` (offline `InMemoryStorageProvider` → `memory://` URI)
  - persist `uploaded_files` row inside `RlsService.run` (user-scoped isolation), DB-default `temporary` mode / `temporary_upload` scope
  - attached `conversationId` ownership re-checked (user-scoped `conversation.findUnique`, 404) BEFORE storing bytes → no orphan
  - untrusted filename sanitized (basename, strip control + path/markup-unsafe chars, NFC, ≤200, fallback `upload`)
- Thin `UploadController` (`POST /uploads`, `@Roles("user")`) using `FileInterceptor` (multer default memory storage + `limits.fileSize`); structural `MultipartFile`/`UploadFilePart` types → no `@types/multer` dependency.
- Swappable contracts + offline defaults: `storage-provider.ts`, `malware-scanner.ts`, `upload.tokens.ts` (`STORAGE_PROVIDER`/`MALWARE_SCANNER`), `upload.defaults.ts` (one composition root), `upload-content-types.ts` (allowlist + `MAX_UPLOAD_BYTES` + `normalizeContentType`).
- New shared `uploadCreateSchema` + `UploadedFileDto`/`UploadCreateInput` (`packages/shared/src/upload.ts`), exported from the index.
- Tests: `upload.service.test.ts` (16 cases — happy txt/pdf/xlsx, MIME-normalize, empty, oversize, unsupported type, extension spoof, no-extension, magic mismatch, short-buffer, malware reject ×2, owned/unowned conversation, filename sanitize, fallback name) + `malware-scanner.test.ts` + `storage-provider.test.ts`.

**Key decisions:**
- **Scope kept tight to M5.1.** Mode/retention (`temporary` vs `persistent`) is deferred to M5.2 — `mode` is NOT in the request yet; every upload persists under the DB default `temporary`. Parsing into `upload_chunks` is deferred to M5.2/M5.3; M5.1 stores the raw file + a validated row, NOT chunks. So the M1.1 `ParserRegistry` PDF/DOCX/XLSX seam is intentionally untouched (M5.1 only allowlists + magic-sniffs those types).
- **Offline-default seams over real drivers**, mirroring the ingestion `EMBEDDING_PROVIDER`/`createDefaultLlmProvider` pattern: in-memory storage + EICAR-signature scanner run the full path with no network/GCS/AV, swap at one composition root. EICAR is the standard harmless AV test signature → the scan path is genuinely exercised and asserted.
- **Layered, defense-in-depth validation** because uploads are an untrusted trust boundary (PRD §"Security"): a declared `Content-Type` and filename are attacker-controlled, so extension + magic-byte cross-checks back the MIME allowlist (a renamed binary is rejected).
- **Ownership re-checked before storing bytes**, not after, so a rejected `conversationId` attach never leaves an orphaned object/row. Same `user_scoped` `conversation.findUnique` boundary as `SavedAnswerService`.
- **No `@types/multer` dep** — structural `MultipartFile` type (the chat `SseResponse` precedent); keeps the dependency surface + knip clean.

**Files changed:**
- `packages/shared/src/upload.ts` (new) + `packages/shared/src/index.ts` — `uploadCreateSchema`, `UploadCreateInput`, `UploadedFileDto`.
- `apps/api/src/uploads/upload.service.ts` (new) — pipeline + validation/sanitize helpers.
- `apps/api/src/uploads/upload.controller.ts` (new) — `POST /uploads` multipart adapter.
- `apps/api/src/uploads/upload.module.ts` (new) — DI wiring.
- `apps/api/src/uploads/upload-content-types.ts` (new) — `UPLOAD_TYPES` allowlist, `MAX_UPLOAD_BYTES`, `normalizeContentType`.
- `apps/api/src/uploads/storage-provider.ts` (new) — `StorageProvider` + `InMemoryStorageProvider`.
- `apps/api/src/uploads/malware-scanner.ts` (new) — `MalwareScanner` + `SignatureMalwareScanner`.
- `apps/api/src/uploads/upload.tokens.ts` + `upload.defaults.ts` (new) — DI tokens + offline-default factories.
- `apps/api/src/uploads/{upload.service,malware-scanner,storage-provider}.test.ts` (new).
- `apps/api/src/app.module.ts` — import `UploadModule`.

**Notes for next iteration:**
- **M5.2** adds `mode` to the request + divergent retention (temporary: `retentionDays`/`expiresAt`, not indexed) vs indexing (persistent: run M1.1 ingestion → `upload_chunks` under `user_private`/`tenant_customer`). The DTO already carries `mode`, so it's non-breaking. This is where the real PDF/DOCX/XLSX parsers land in `ParserRegistry`. `InMemoryStorageProvider` keeps bytes by key, but `StorageProvider` needs a `get`/`download` method (+ the real GCS driver) for a parse step to read them back.
- **Uploads are not yet readable by retrieval/chat** — `upload_chunks` is empty until M5.2; `RetrievalService`/`ChatService` must fold in the user's uploaded chunks (M5.2+), and `Citation.uploadChunkId` populated so `ChatCitationDto.kind` derives `"upload"` (info-blue `.cite.upload`, M5.4 — the read-path seam is already in place from M4.2).
- Real DB write path is seam-tested with a mocked tx (M11 Testcontainers caveat, same as the other stores). multer resolves from `@nestjs/platform-express`'s context at runtime (verified), not hoisted to apps/api.

---

## M5.2 — Temporary vs persistent upload modes (retention + indexing strategy per mode)

**PRD:** Phase 1 / M5 / M5.2 (§"Document-assisted Q&A"). **Date:** 2026-06-01.

**What shipped.** Upload mode (`temporary` | `persistent`) now drives a divergent retention + indexing strategy, and `UploadService.upload` graduated from store-only (M5.1) to store-and-index.

- **Shared (`packages/shared/src/upload.ts`):** `uploadCreateSchema` gains `mode` (zod enum, `.default("temporary")` → omitting it is non-breaking, keeps M5.1 behavior). New `UploadMode` type. `UploadedFileDto` gains `chunkCount` (how many searchable chunks were indexed — `0` signals a not-yet-parseable binary) and `expiresAt` (set for temporary, null for persistent).
- **Indexing seam (`ParserRegistry.tryResolve → Parser|null`):** returns null instead of throwing `UnsupportedContentTypeError`, so the upload path can treat an allowlisted-but-unparseable format (PDF/DOCX/XLSX) as "store now, index when its parser lands (M5.3)" rather than an error. `resolve` now delegates to `tryResolve`.
- **`UploadService` (`apps/api/src/uploads/upload.service.ts`):** after validate→scan→conversation-ownership, it parses (reusing the ingestion `ParserRegistry`)→chunks (`chunkText`)→embeds (`createDefaultEmbeddingProvider`, the *same* model as ingestion/retrieval, behind new `UPLOAD_PARSER_REGISTRY`/`UPLOAD_EMBEDDING_PROVIDER` tokens) **before** storing bytes (an embed failure stores nothing — no orphan). Then one `RlsService.run` creates the `uploaded_files` row **and** its `upload_chunks` atomically, embeddings written via raw `UPDATE upload_chunks SET embedding=$1::vector` (the `DocumentVersionRepository` pattern; `upload_chunks` is `tenant_only` RLS). Pure `retentionFor(mode)` maps mode→`{scope, expiresAt}`: temporary→`temporary_upload`+`expiresAt=now+TEMPORARY_RETENTION_DAYS(7)d`+`retentionDays=7`; persistent→`user_private`+null/null. Embedding cost recorded (`upload.embed`) only when chunks are produced.
- **Module wiring:** `UploadModule` provides the two new tokens from the ingestion factories; `UsageLogService` injected (global ObservabilityModule).

**Decisions.**
1. **Both modes parse into `upload_chunks`** — the divergence is **scope + retention**, not whether-parsed. PRD framing: temporary = transient chunks scoped to the session (excluded from searchable knowledge), persistent = indexed into user-private knowledge. So a temporary CSV *does* produce chunks; they're just session-scoped + expiring.
2. **Retrieval/chat folding deferred to M5.4.** M5.2 *writes* `upload_chunks`; nothing *reads* them yet. M5.4 extends `RetrievalService`/`ChatService` to fold in a user's uploads (temporary = this question only) + distinct info-blue upload citations + per-user isolation (isolate via the `user_scoped` `uploaded_files` join, since `upload_chunks` is `tenant_only`). The M4.2 read path (`ChatCitationDto.kind`, `loadCitations` deriving `kind` from `uploadChunkId`) is already in place.
3. **Binary parsers (PDF/DOCX/XLSX) land in M5.3.** `tryResolve` is the store-now/index-later seam; today those types store with `chunkCount: 0`. This avoids regressing M5.1 (which stores binary uploads fine) while being honest (the DTO reports 0 chunks).
4. **No `StorageProvider.get` added (yet).** M5.2 parses from the in-hand validated buffer (already in memory, already scanned) rather than re-reading from storage. M5.3's binary-backfill is what needs `get`/`download` + the real GCS driver.
5. **No migration** — schema already had `mode`/`scope`/`retention_days`/`expires_at` on `uploaded_files` and the `upload_chunks` table + HNSW index (from M5.1's init schema).

**Gates.** typecheck ✅ · test ✅ (409 pass: shared 64, ui 3, db 9, ai 126, api 207 — +5 upload.service tests) · lint ✅ · build ✅ · knip ✅. `upload.service.ts` = 100%/96.77%/100%/100% (only the pre-existing defensive `?? ""` fallback + the embed-mismatch guard uncovered — the accepted defensive-throw pattern, mirroring `ingestion.service.ts`).

**Notes for next iteration (M5.3 / M5.4):**
- **M5.3 (spreadsheet handling):** register real PDF/DOCX/XLSX parsers at the `ParserRegistry` seam (where `tryResolve` returns null today). For XLSX: sheets/tables/headers, real numeric values, and populate `upload_chunks.sheet_name`/`cell_ref` for sheet/cell citations. Add `StorageProvider.get`/`download` + the real GCS driver for any backfill (re-read stored bytes); M5.2 only parses the in-hand buffer.
- **M5.4 (upload citations + retrieval folding):** `upload_chunks` is now populated but unread — fold into retrieval, populate `Citation.uploadChunkId` (M4.2 read path already derives `kind: "upload"` → info-blue `.cite.upload`/`badge-info`), and isolate per-user via the `uploaded_files` join (`upload_chunks` is `tenant_only`, not `user_scoped`).
- **Web upload UI** can now offer a temporary/persistent picker and surface `chunkCount`/`expiresAt` from the DTO (deferred with the rest of the consumer-web surface).
- Real DB write path (file row + chunks + raw embedding) is seam-tested with a mocked tx — M11 Testcontainers caveat, same as the other raw-SQL stores.

---

## M5.3 — Spreadsheet handling (sheets/tables/headers, row/col refs, real numeric values, sheet/cell citations)
**Date:** 2026-06-01
**Ref:** PRD §"Document-assisted Q&A" / Task Manifest M5.3

**What was done:**
- **Core abstraction — provenance-carrying chunks.** Extended the `Parser` contract (`apps/api/src/ingestion/parser.ts`) with optional `ParsedDocument.chunks?: ParsedChunk[]` (`{content, sheetName?, cellRef?}`). When a parser pre-segments (spreadsheets), `UploadService.buildIndexedChunks` persists those chunks verbatim — one `upload_chunks` row each, carrying `sheet_name`/`cell_ref` — instead of running `chunkText` over a flattened blob (which destroyed row identity). Backward-compatible: the M1.1 text-only ingestion pipeline ignores `chunks` and always chunks `text`.
- **Shared renderer** `apps/api/src/ingestion/parsers/spreadsheet.ts`: `SheetTable` model → `renderSheets()` (one chunk per data row, `header: value` lines, empty cells skipped, sheet name + A1 cell range `A2:C2`) + `renderText()` (flat-text for ingestion). `columnLetter()` (0→A, 26→AA). Blank rows skipped but row numbers stay source-aligned (header = row 1). `MAX_SPREADSHEET_ROWS = 5000` cap (untrusted-boundary cost guard — one embedding/row).
- **CSV** parser (`csv-parser.ts`) enhanced to emit structured chunks (single unnamed sheet) while keeping its flat `text` output byte-stable (no ingestion regression; existing CSV tests unchanged).
- **XLSX** support, dependency-free: `parsers/zip.ts` (read-only ZIP reader over `node:zlib` `inflateRawSync` — central-directory parse, stored + deflate methods, 32 MiB per-entry inflate cap as a zip-bomb guard, `InvalidZipError` on malformed) + `parsers/xlsx-parser.ts` (workbook sheet names, `workbook.xml.rels`, `sharedStrings.xml` incl. rich-text runs, each worksheet's cells). Extracts each cell's **real stored `<v>`** so `1200000` stays `1200000` (never a formatted display string) — the "real numeric values" guarantee; handles shared strings (`t="s"`), inline strings, booleans, and XML entity decoding. Registered in `createDefaultParserRegistry` (ingestion + upload share it).
- `UploadService.buildIndexedChunks` now wraps `parser.parse` in try/catch — a malformed/spoofed-but-magic-valid file (e.g. a fake XLSX) is stored unindexed (`chunkCount 0`, warn-logged), NOT a 500. `IndexedChunk` + `persistChunks` carry `sheetName`/`cellRef`.
- `normalizeText` exported from `@expertos/ai` (the renderer NFC-normalizes stored chunk content, matching `chunkText`, since it bypasses `chunkText` for pre-segmented chunks — load-bearing for VI).

**Key decisions:**
- **Dependency-free XLSX reader as the offline default** over adding a JS library (exceljs/sheetjs). Matches the codebase's offline-default + swap-real-driver-behind-a-seam philosophy (storage/scanner/embedding all follow it), and is safest for the untrusted-upload boundary — no CVE-bearing parser dependency in the attacker-controlled path. The `Parser` seam still permits swapping a sandboxed Python worker later (PRD hybrid-ready note). (User was asked to confirm the approach; question dismissed → proceeded with the recommended default.)
- **Per-row chunks** (not row-groups) for citation precision (cite a specific row), capped at 5000 rows for cost.
- **Graceful degradation on parse failure** — store-but-don't-index, consistent with the existing unsupported-format (PDF) path; an untrusted file must never crash the request or block storage.
- **PDF/DOCX parsing left deferred** (still stored-but-0-chunks) — M5.3's line item is specifically spreadsheet handling.

**Files changed:**
- `apps/api/src/ingestion/parser.ts` — new `ParsedChunk` + optional `ParsedDocument.chunks`.
- `apps/api/src/ingestion/parsers/spreadsheet.ts` (new) — `SheetTable`, `renderSheets`, `renderText`, `columnLetter`, `MAX_SPREADSHEET_ROWS`.
- `apps/api/src/ingestion/parsers/zip.ts` (new) — minimal read-only ZIP reader + `InvalidZipError`.
- `apps/api/src/ingestion/parsers/xlsx-parser.ts` (new) — `XlsxParser`.
- `apps/api/src/ingestion/parsers/csv-parser.ts` — emit structured chunks (text byte-stable).
- `apps/api/src/ingestion/ingestion.defaults.ts` — register `XlsxParser`.
- `apps/api/src/uploads/upload.service.ts` — `chunks`-or-`chunkText` indexing, try/catch parse, `sheetName`/`cellRef` persistence.
- `packages/ai/src/index.ts` — export `normalizeText`.
- Tests: `spreadsheet.test.ts`, `xlsx-parser.test.ts` (inline `makeZip` via `deflateRawSync`), `csv-parser.test.ts` (+chunk assertions), `upload.service.test.ts` (+prose-fallback / CSV provenance / malformed-XLSX). +20 api tests → 429 total.

**Notes for next iteration:**
- **M5.4** reads these chunks: `upload_chunks.sheet_name`/`cell_ref` are now populated — surface a sheet/cell label (e.g. `Q1 KPIs!A2:B2`) on the upload `Citation` when folding upload chunks into retrieval + setting `Citation.uploadChunkId`; isolate per-user via the `uploaded_files` join (`upload_chunks` is `tenant_only`). The M4.2 read path already derives `kind: "upload"` → info-blue `.cite.upload`/`badge-info`.
- **PDF/DOCX parsers** still unbuilt (stored-but-0-chunks); register in `createDefaultParserRegistry` when added. PDF → flat `text`; DOCX tables could emit `chunks` too.
- XLSX extracts stored values, not formatted display — would need `styles.xml`/number-format parsing if the formatted string is ever wanted.
- Parser/zip files aren't coverage-gated (only `*.service.ts` is) but have unit tests; the raw DB write path stays seam-tested (mocked tx) — M11 Testcontainers caveat.

---

## M5.4 — Distinct upload citations + retrieval folding
**Date:** 2026-06-01
**Ref:** PRD §"Document-assisted Q&A" / §"Design System"; Task Manifest M5.4 (closes M5)

**What was done:**
- Built the **read path** for query-time uploads that M5.2/M5.3 wrote but nothing consumed. A user's own uploaded chunks are now folded into chat retrieval and cited distinctly (info-blue).
- New `PgUploadChunkStore` (`apps/api/src/retrieval/upload-chunk.store.ts`) — pgvector cosine over `upload_chunks ⋈ uploaded_files`. Scope follows the M5.2 mode contract: `persistent` always foldable; `temporary` only when attached to the current conversation and unexpired (`expires_at IS NULL OR > now()`). Isolation is the `uploaded_files` (`user_scoped`) JOIN under RLS — no manual `user_id`/`tenant_id` predicate.
- New `RetrievalService.retrieveUploads(user, {text, topK, conversationId?})` — embeds the query via a new shared private `embedQuery` helper (refactored out of `retrieve`), runs the store inside `RlsService.run`, usage-logs `upload.retrieve.embed`.
- `ChatService.answerStream` now retrieves uploads (cap `UPLOAD_FACT_TOPK=5`) and appends them as facts **after** knowledge, so knowledge keeps markers `[1..N]` and uploads follow `[N+1..]`. An upload fact carries `kind:"upload"`, `uploadChunkId`, `sourceLabel` (`filename · sheet!cell`), and empty `chunkId`/`documentVersionId`. New `uploadSourceLabel` helper builds the label.
- `@expertos/ai`: added optional `uploadChunkId`/`sourceLabel`/`kind` to `PromptFact`, and `uploadChunkId`/`sourceLabel` to `CitationSource`/`ResolvedCitation`; `buildCitations` carries them through (resolves an upload marker identically to a knowledge one).
- Persistence: `ConversationService.TurnCitation` gains `uploadChunkId`; `persistTurn` writes it and coalesces empty `chunkId`/`documentVersionId` → null (a uuid column rejects `""`). `ChatService` filters empty doc-version ids out of `sourceVersionIds`.
- `ChatCitationDto` gains optional `sourceLabel`; `toCitationDto` sets it. `loadCitations` already derived `kind` from `uploadChunkId` (M4.2) — unchanged.
- Web: `apps/web/app/chat/page.tsx` sources drawer shows `sourceLabel` for upload citations in place of `documentVersionId` (info-blue `.cite.upload` already wired in M4.2).
- Tests +10 (439 total): `retrieval.service.test.ts` ×2, new `upload-chunk.store.test.ts` ×4, `chat.service.test.ts` ×2, `conversation.service.test.ts` ×1, `citations.test.ts` ×1.

**Key decisions:**
- **Two independent embeds (knowledge + upload) over one shared vector.** Each retrieval seam stays single-responsibility and independently testable; the extra embed of one short question is negligible. A shared-vector optimization is documented as an open follow-up rather than coupling the two methods now.
- **Temporary uploads are conversation-scoped** (the natural "session" boundary), **persistent are user-wide.** This matches the M5.2 retention semantics exactly and needs no new "session" concept.
- **Knowledge-before-upload ordering** keeps knowledge citation numbers stable regardless of how many uploads fold in.
- **`insufficientKnowledge` stays `facts.length === 0`** (now counting uploads) — an answer grounded only on the user's own upload is correctly NOT flagged insufficient. Deliberately did not couple it to knowledge-only count.
- **`sourceLabel` only on the live `done` event** (no column stores it); the history read path re-hydrates `kind` but not the label — keeps the change minimal. Documented how to JOIN it back in if a history view ever needs it.

**Files changed:**
- `packages/ai/src/prompt/types.ts` — `PromptFact` gains optional `kind`/`uploadChunkId`/`sourceLabel`.
- `packages/ai/src/prompt/citations.ts` — `CitationSource`/`ResolvedCitation` gain `uploadChunkId`/`sourceLabel`; `buildCitations` carries them through.
- `packages/shared/src/chat.ts` — `ChatCitationDto` gains optional `sourceLabel`.
- `apps/api/src/retrieval/upload-chunk.store.ts` — NEW `PgUploadChunkStore`.
- `apps/api/src/retrieval/retrieval.service.ts` — NEW `retrieveUploads` + shared `embedQuery`.
- `apps/api/src/chat/chat.service.ts` — fold uploads as facts; `uploadSourceLabel`; persist `uploadChunkId`; filter empty `sourceVersionIds`.
- `apps/api/src/chat/conversation.service.ts` — `TurnCitation.uploadChunkId`; null-coalesce empty knowledge ids in `persistTurn`.
- `apps/web/app/chat/page.tsx` — drawer shows `sourceLabel` for uploads.
- Tests: `apps/api/src/retrieval/{retrieval.service,upload-chunk.store}.test.ts`, `apps/api/src/chat/{chat.service,conversation.service}.test.ts`, `packages/ai/src/prompt/citations.test.ts`.

**Notes for next iteration:**
- **M5 is closed.** Next is **M6.1** (entitlement catalog + `plan_entitlements` matrix + `@RequiresEntitlement` guard + `/me/entitlements`); M6.5 is gated on OD#4 but M6.1's scaffolding isn't.
- **No web upload UI yet** — the API path is end-to-end (store→index→fold→cite) but `apps/web` has no file picker / temp-vs-persistent mode toggle. That's the open consumer work now that uploads actually answer questions.
- **Two query embeds per chat turn now** (knowledge + upload). If a real embedding provider makes this matter, share one vector across both stores in `RetrievalService`.
- **History view + `sourceLabel`:** the live event carries it, the persisted read path doesn't. JOIN `upload_chunks`→`uploaded_files` in `loadCitations` if a history drawer ever needs the upload label (handle a `SetNull`'d chunk).
- **Still seam-tested only** (mocked tx) — the real `upload_chunks ⋈ uploaded_files` cosine + mode/expiry WHERE join the M11 Testcontainers list.

---

## M6.1 — Entitlement catalog + plan_entitlements matrix + @RequiresEntitlement guard + /me/entitlements
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest Phase 1 M6.1; PRD §"Paywall, Entitlements & Feature Gating"

**What was done:**
- **Starts M6 (subscriptions) — the first feature-gating surface.** The catalog default + plan×feature matrix already existed in the DB seed (`packages/db/prisma/seed.ts`: free/plus/premium × 7 features); M6.1 builds the **runtime** that reads and enforces it.
- New `apps/api/src/entitlements/` module:
  - **`EntitlementService`** — the single choke point. `resolvePlan` → actor's live subscription (`active`/`trialing`) else Free. `getEntitlements(user)` → `/me/entitlements` data (each feature's boolean access or metered `limit`/`used`/`remaining` for the current window). `enforce(user, feature)` → the guard's reserve-before-work check: fail-closed on unknown/disabled (402), allow on boolean-enabled and metered-unlimited/no-window, and for a capped metered feature atomically increment the per-window `usage_counters` row then verify (over-cap throws 402 → the increment rolls back in the same transaction).
  - **`@RequiresEntitlement(feature)` decorator + `EntitlementGuard`** — mirrors the `@Roles`/`RolesGuard` pattern; registered as a global `APP_GUARD` in `EntitlementsModule` (no-op without the decorator).
  - **`EntitlementsController`** — `GET /me/entitlements` (shares the `/me` base path with `MeController`).
- **Wired the gate live:** `ChatController` `POST /chat` carries `@RequiresEntitlement("ask_question")` — a real chat turn now consumes one question-quota unit or 402s at the wall.
- New shared contract `packages/shared/src/entitlements.ts`: `FeatureKey` (typing the decorator) + `EntitlementView`/`EntitlementsDto`/`EntitlementDeniedPayload`.
- **`AllExceptionsFilter`** enhanced to echo a structured HttpException object response verbatim (alongside normalized `statusCode`/`message`/`requestId`) so the flat 402 entitlement body (`reason`/`feature`/`currentPlan`/`upgradeOptions`/`remainingQuota`) reaches the client — previously every error was flattened to `{statusCode,message}`.
- Tests: +19 in apps/api (14 service, 4 guard, 1 filter). Full suite 458 pass / 0 fail.

**Key decisions:**
- **Runtime reads the DB matrix, not a code default.** The seed is the default; `plan_entitlements` is the admin-editable source of truth (M8.3) so the business model changes with no deploy. Chose this over a hardcoded code matrix to honor the PRD's "config not code" principle.
- **Reserve-before-work via in-transaction increment-then-check-then-rollback** rather than `SELECT … FOR UPDATE` — atomic and race-safe (exactly `limit` uses succeed per window) using Prisma's upsert + the wrapping `RlsService.run` transaction.
- **Pinned `userId` in plan/counter lookups** even though the tables are RLS-`user_scoped`: an `admin` actor bypasses RLS, so a bare `findFirst` would resolve a peer's subscription. This is self-lookup by natural key, not the isolation predicate directive §4.21 bans (same shape as `AnswerFeedback`'s `userId_messageId`).
- **Wired onto `/chat` now, not deferred.** Free's 5/month is an OD#4 placeholder but admin-tunable; the guard is controller-level so service-level chat tests are unaffected, and there's no committed HTTP e2e. Demonstrates the guard end-to-end like `/me/admin` demonstrates `RolesGuard`.
- **Enhanced the global exception filter** (small, well-tested superset) instead of nesting the 402 payload under `message` — a genuine improvement (aligns with NestJS's default filter) that any structured-error endpoint benefits from; only deliberately-authored HttpException object bodies pass through, so a generic 500 still leaks nothing.
- **`enforce` allows metered-unlimited outright** — the fair-use "degrade to a cheaper model instead of blocking" is M6.3, deliberately not built here.

**Files changed:**
- `packages/shared/src/entitlements.ts` — new: `FeatureKey`, `EntitlementView`, `EntitlementsDto`, `EntitlementDeniedPayload`.
- `packages/shared/src/index.ts` — export the new entitlement types.
- `apps/api/src/entitlements/entitlement.service.ts` — new: the choke point (`getEntitlements` + `enforce` + plan/usage resolution + UTC window-start keying).
- `apps/api/src/entitlements/requires-entitlement.decorator.ts` — new: `@RequiresEntitlement` + `REQUIRES_ENTITLEMENT_KEY`.
- `apps/api/src/entitlements/entitlement.guard.ts` — new: global guard reading the metadata → `enforce`.
- `apps/api/src/entitlements/entitlements.controller.ts` — new: `GET /me/entitlements`.
- `apps/api/src/entitlements/entitlements.module.ts` — new: wires the service + controller + global guard; imports `AuthModule`.
- `apps/api/src/entitlements/entitlement.service.test.ts` — new: 14 tests.
- `apps/api/src/entitlements/entitlement.guard.test.ts` — new: 4 tests.
- `apps/api/src/app.module.ts` — register `EntitlementsModule`.
- `apps/api/src/chat/chat.controller.ts` — add `@RequiresEntitlement("ask_question")` to `POST /chat`.
- `apps/api/src/observability/all-exceptions.filter.ts` — echo structured HttpException object bodies.
- `apps/api/src/observability/all-exceptions.filter.test.ts` — +1 test for the structured-payload pass-through.

**Notes for next iteration:**
- **M6.2 is next** — `PaymentProvider` abstraction (Stripe driver) + idempotent webhooks → upsert `subscriptions` + append `transactions`. This is what finally populates the `subscriptions` rows `resolvePlan` already reads (today everyone is Free). Mirror the `STORAGE_PROVIDER`/`EMBEDDING_PROVIDER` composition-root + offline-default pattern; no app code imports the Stripe SDK directly.
- **M6.3** (usage indicator) consumes the `/me/entitlements` read path built here; it's also where metered-unlimited "degrade-don't-block" lands (the gate currently allows unlimited outright).
- **Seam-tested with a mocked tx** — the upsert-increment-rollback race-safety + the real `usage_counters` unique join the M11 Testcontainers list with the raw-SQL stores.
- **Keep `FeatureKey` (shared) in lockstep with the seed's `FEATURES` list** — drift fail-closes an unknown key. M8.3's matrix editor must not introduce a key the code doesn't know.
- **The `EntitlementGuard` is a global `APP_GUARD`** — its ordering after the auth guards relies on `EntitlementsModule` importing `AuthModule`; keep that import.

## M6.2 — PaymentProvider abstraction (Stripe driver) + idempotent webhooks → subscription/ledger sync
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M6.2; §"Paywall, Entitlements & Feature Gating" (payment-provider abstraction + paywall flow)

**What was done:**
- New `apps/api/src/billing/` module — the integration point that finally **writes** the `subscriptions` rows `EntitlementService.resolvePlan` already reads (until now everyone resolved to Free).
- **`PaymentProvider` interface** (`payment-provider.ts`): `createCheckoutSession`/`openCustomerPortal`/`verifyWebhook`/`parseEvent`/`cancelSubscription` + the normalized **`BillingEvent`** union (`SubscriptionChange` | `LedgerEntry`) + `WebhookVerificationError`. No app code imports the Stripe SDK directly.
- **`OfflinePaymentProvider`** (default): `offline://` checkout/portal URLs; webhook = trusted JSON `BillingEvent` envelope (parsed by exported `parseOfflineEvent`) so local/test drives the same DB-sync path Stripe would.
- **`StripePaymentProvider`**: real `node:crypto` HMAC-SHA256 webhook **signature verification** (Stripe `t=…,v1=…` scheme, replay-tolerance window, constant-time compare) + **event parsing** (`customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}`, `charge.refunded`); checkout/portal/cancel build Stripe REST params through an injected `StripeHttpClient` seam (`FetchStripeHttpClient` default transport).
- **`BillingService`** (coverage-gated, 100%): `createCheckout`/`createPortal` under the user's RLS; `handleWebhook` verifies (→400 on bad sig) then idempotently syncs in a system RLS context — subscriptions upsert by `providerSubId`, transactions insert keyed by `[provider, providerRef]` (= event id).
- **`BillingController`**: `POST /billing/checkout` + `/portal` (`@Roles("user")`), `POST /billing/webhook` (`@Public()`, reads `req.rawBody`). `main.ts` now `NestFactory.create(.., { rawBody: true })`. Wired `BillingModule` into `AppModule`.
- Shared `billingCheckoutSchema` + `CheckoutSessionDto`/`PortalSessionDto` (`packages/shared/src/billing.ts`, exported from index).
- 55 new api tests (billing.service ×27, offline provider ×13, stripe provider ×15). Suite 458 → 513.

**Key decisions:**
- **Offline default + Stripe-behind-a-token** mirrors `STORAGE_PROVIDER`/`EMBEDDING_PROVIDER` (`billing.defaults.ts` resolves Stripe only when both env secrets present). Keeps the whole flow runnable in CI/local without Stripe or network.
- **Idempotency key = provider event id** (`providerRef`), not invoice id — a failed-then-paid invoice would otherwise collide; event ids are unique per delivery and stable across retries.
- **Webhook uses the raw body** (signature is HMAC over the unparsed bytes) — `rawBody:true` + `req.rawBody`; the route is `@Public()` (signature-verified, not Firebase).
- **Redirect URLs server-chosen** from `WEB_APP_URL` — never client-supplied (open-redirect guard).
- **Stripe driver REST transport (fetch) deferred to deploy-time** (live network, not CI) — same caveat as the GCS storage driver; the verify/parse/param-build logic is fully unit-tested. Implemented the security-critical signature verification myself (node:crypto) rather than depend on the Stripe SDK, consistent with the repo's structural-typing / no-heavy-deps philosophy.
- **Seed `provider_price_id` left null** — real Stripe ids come from the dashboard / M8.3 admin editor; `createCheckout` correctly 400s until a price is configured. The webhook→DB-sync path is the offline-demoable part.

**Files changed:**
- `apps/api/src/billing/{payment-provider,offline-payment-provider,stripe-payment-provider,billing.tokens,billing.defaults,billing.service,billing.controller,billing.module}.ts` — new module + 3 test files.
- `apps/api/src/app.module.ts` — import `BillingModule`.
- `apps/api/src/main.ts` — `rawBody: true` for webhook signature verification.
- `packages/shared/src/billing.ts` (new) + `packages/shared/src/index.ts` — billing DTOs/schema export.

**Notes for next iteration:**
- **M6.3 (usage indicator + fair-use degrade-don't-block)** is next: a live subscription now resolves a real Plus/Premium plan, so `/me/entitlements` shows a non-Free quota. The metered-unlimited "degrade to a cheaper model instead of blocking" still belongs in M6.3 (`enforce` allows unlimited outright today).
- The Stripe REST transport (`FetchStripeHttpClient`) joins the M11 integration list (needs live Stripe). The webhook signature/parse logic does NOT (fully unit-tested with computed signatures).
- `cancelSubscription` is implemented on both drivers + the interface but **has no caller yet** — wire it into the M8.4 admin "manage subscriptions" action or a user-initiated cancel.
- `subscriptions.tenant_id` on a mirrored row is set to the resolved user's tenant (not GLOBAL) — correct for B2B later.

## M6.3 — Transparent usage indicator + fair-use thresholds + degrade-don't-block
**Date:** 2026-06-01
**Ref:** PRD §"Paywall, Entitlements & Feature Gating" / §"Design System" — Task Manifest M6.3

**What was done:**
- Added nullable `plan_entitlements.soft_limit` column (migration `20260601010000_entitlement_soft_limit`) — the per-entitlement fair-use threshold, admin-tunable alongside `limit`/`window`. Seed sets Premium `ask_question` `softLimit: 1000` (hard `limit` stays null).
- `EntitlementService.enforce` now returns an `EntitlementDecision` (`allow` | `degraded`; block still throws `402`). A metered feature with a `softLimit` now meters even when `limit` is null (unlimited): reserve-before-work increment → hard-cap check (block, rolls back) → soft-threshold check (degrade). Truly-unlimited (both null) early-allows with no counter write. `getEntitlements` surfaces `softLimit`.
- `EntitlementGuard` stashes the decision on the request; new `@EntitlementDecisionParam()` decorator (mirrors `@CurrentUser`) reads it. `ChatController` threads `{ degraded }` into `ChatService.answerStream`.
- New `CHAT_DEGRADED_LLM_PROVIDER` token + `createDegradedLlmProvider()` (offline `EchoLlmProvider("echo-dev-mini")`). `ChatService` selects `degraded ? this.degradedLlm : this.llm` — the only behavioural fork. `done` event now carries `degraded`; usage log + structured log record it.
- New `UsageMeter` UI primitive (`packages/ui`) over the existing `.bar`/`.bar.warn` — measures `used` against `limit` else `softLimit`, warns near/over the threshold, reads "Unlimited" when neither set. New token-only `.meter` styles in `ds.css`.
- `EchoLlmProvider` constructor takes an optional `name`. New shared fields `EntitlementView.softLimit` + `ChatStreamEvent.done.degraded`.
- Tests: api +7, ai +1 (total 521). Updated existing enforce tests (return value `{outcome:"allow"}`), getEntitlements exact-match (`softLimit: null`), guard test (stable request + stash assertion), chat service/controller (degraded provider injected + degrade-path tests).

**Key decisions:**
- `soft_limit` as a real DB column (config-not-code, admin-editable via M8.3) over a code constant — the matrix *is* the business model; additive/nullable = backwards-compatible.
- Hard-cap check precedes the soft-threshold check, so a capped plan is never silently downgraded to a fair-use pass.
- Degrade still consumes quota (reserve-before-work) so fair-use usage is tracked — degrade is not a free pass.
- Decision propagation via a request-stashed value + param decorator (the `@CurrentUser` pattern) keeps `ChatService` request-agnostic; the guard remains the single reserve point (no double-metering).
- `UsageMeter` takes plain props (not `@expertos/shared`) so `packages/ui` stays dependency-free; consumers map `EntitlementView` → props.

**Files changed:**
- `packages/db/prisma/schema.prisma` + `migrations/20260601010000_entitlement_soft_limit/migration.sql` — `soft_limit` column.
- `packages/db/prisma/seed.ts` — `softLimit` in the matrix `Cell` + Premium `ask_question` 1000.
- `apps/api/src/entitlements/entitlement.service.ts` — `EntitlementDecision` type, metered-degrade logic, `softLimit` in `getEntitlements`.
- `apps/api/src/entitlements/entitlement.guard.ts` — stash decision on request.
- `apps/api/src/entitlements/entitlement-decision.decorator.ts` — new `@EntitlementDecisionParam()` + request key.
- `apps/api/src/chat/{chat.tokens,chat.module,chat.service,chat.controller}.ts` — degraded provider token/wiring/selection + decision passthrough.
- `apps/api/src/ingestion/ingestion.defaults.ts` — `createDegradedLlmProvider()`.
- `packages/ai/src/llm/echo-llm-provider.ts` — optional `name`.
- `packages/shared/src/entitlements.ts` + `chat.ts` — `softLimit` + `done.degraded`.
- `packages/ui/src/UsageMeter.tsx` + `index.ts` + `ds.css` — usage meter primitive + styles.
- Test files: `entitlement.service.test.ts`, `entitlement.guard.test.ts`, `chat.service.test.ts`, `chat.controller.test.ts`, `echo-llm-provider.test.ts`.

**Notes for next iteration:**
- **M6.4 caching must be entitlement-aware:** a cached answer must not serve a degraded (cheaper-model) answer to a standard-tier user, and a cache hit must not re-reserve/double-count quota (the gate already reserved on the request path). Tier could be part of the answer-cache key.
- **M6.5 (OD#4)** just sets the real numbers now that `soft_limit` is a tunable column — calibrate Free 5 / Plus 100 / Premium softLimit 1000 against cost-per-answer, plus the degraded model's cost envelope.
- **Web:** the `/me/entitlements` usage page (consuming `UsageMeter`) and the chat `done.degraded` fair-use note are not built — the API + UI primitive are ready.
- **Real metering** of an unlimited+softLimit feature (the `usage_counters` upsert/rollback under real pgvector/RLS) joins the M11 Testcontainers list — seam-tested with a mocked tx, same caveat as M6.1.
- **Sandbox quirk reminder:** `pnpm build`/`turbo run typecheck` regenerate the Prisma client with the default **library** engine, which SIGILLs api tests at runtime on this box. Re-run `PRISMA_CLIENT_ENGINE_TYPE=binary prisma generate` in `packages/db` before running api tests. Also `turbo run typecheck` races two concurrent `prisma generate` (db build + db typecheck) after a schema change → ENOENT copyfile; run with `--concurrency=1`.

## M6.4 — Caching layers (semantic → retrieval → answer)
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M6.4 (§"Paywall, Entitlements & Feature Gating" / architecture "Aggressive caching")

**What was done:**
- New `apps/api/src/cache/` module — the three caching layers behind one choke point `ResponseCacheService`:
  - `lru-cache.ts` — generic in-process LRU with per-entry TTL, clock-injectable (deterministic tests). The documented Redis/Memorystore swap point.
  - `response-cache.service.ts` — `ResponseCacheService`: builds the retrieval + answer cache keys, owns two in-process LRUs, and orchestrates the persistent semantic tier. Keys are pure string composites (NFC+lowercase+collapse-whitespace on the query). The answer key includes the **model tier** (entitlement correctness).
  - `semantic-cache.store.ts` — `PgSemanticCacheStore`: persistent answer tier over the `semantic_cache` table (exact normalized-key + model match; replace-then-create write; hit-counter bump; age cutoff). Constructed per-call with the active RLS tx (mirrors `PgVectorStore`).
  - `cache.types.ts` (`CachedAnswer`/`CachedCitation`), `cache.config.ts` (TTL/size constants), `cache.module.ts`.
- Wired the retrieval cache into `RetrievalService.retrieve` (hit skips embed + DB + `retrieve.embed` usage log; miss populates).
- Wired the answer/semantic cache into `ChatService.answerStream`: cacheable = standalone + knowledge-only turn; `serveCachedAnswer` streams the cached prose, persists the turn into the asker's conversation, records zero model cost; grounded answers write-through after a miss.
- Schema: added `semantic_cache.citations` (jsonb) + `(tenant_id, normalized_question, model)` index; migration `20260601020000_semantic_cache_answer_payload`.
- Tests: +27 in apps/api (lru-cache 6, response-cache 9, semantic-cache.store 5, retrieval +2, chat +6). Total 521→548.

**Key decisions:**
- In-process LRU first (per PRD "Redis when volume justifies it"); the persistent `semantic_cache` table is the durable cross-instance tier (Cloud Run scale-to-zero ⇒ in-process cache is cold often).
- **Cacheable only when standalone + knowledge-only** — a turn with conversation history (context-dependent) or the user's private uploads (user-specific) is never shared. Determined after upload retrieval so we never silently drop a user's private grounding.
- **Model tier in the answer key** so a degraded-model answer is never served to a standard-tier user (the M6.3 entitlement requirement). Cache never touches `usage_counters` — the guard already reserved quota, so a hit neither double-counts nor refunds.
- **Only grounded (≥1 citation) answers are cached** — an uncited "I don't know" must not be pinned (knowledge may be published later).
- **Exact-match semantic lookup now; embedding-cosine approximate match deferred** to the real embedder / M11 (the `embedding` column + HNSW index are reserved — same caveat as every other pgvector path). Added a `citations` jsonb column rather than reconstruct citations lossily from the uuid[] columns.

**Files changed:**
- `apps/api/src/cache/{lru-cache,response-cache.service,semantic-cache.store,cache.types,cache.config,cache.module}.ts` (+ `*.test.ts` for lru/response-cache/store) — new module.
- `apps/api/src/retrieval/retrieval.service.ts` + `.module.ts` + `.test.ts` — retrieval cache wiring.
- `apps/api/src/chat/chat.service.ts` + `chat.module.ts` + `.test.ts` — answer/semantic cache wiring, `serveCachedAnswer`.
- `packages/db/prisma/schema.prisma` + `migrations/20260601020000_semantic_cache_answer_payload/migration.sql` — `citations` column + index.

**Notes for next iteration:**
- See the "M6.4 cache seam" note in progress-state.md. Biggest open follow-up: **publish-time invalidation** (M8) — clearing the in-process caches + the tenant's `semantic_cache` rows when a `document_version` is published/unpublished (TTL is the only invalidation today). And the embedding-cosine approximate match (real embedder / M11).
- M6.5 (OD#4 unit economics → seed quota matrix) is the last open M6 item; the degraded model's cost envelope feeds the cache margin story.

## M6.5 — Resolve Open Decision #4 (unit economics → seed quota matrix)
**Date:** 2026-06-01
**Ref:** PRD §"Paywall, Entitlements & Feature Gating" + §"Open Decisions" #4; Task Manifest M6.5 (closes M6)

**What was done:**
- Turned OD#4's "cost is logged, not modeled" gap into a real per-token cost model and calibrated the seed `ask_question` quotas against it.
- New `apps/api/src/observability/model-pricing.ts` — `costMicrosFor(model, prompt, completion)` keyed by the `model` string callers already log. Tiers (USD/1M tokens): standard $0.15/$0.60, premium $3/$15, degraded mini $0.05/$0.40, embedding $0.02. Offline `echo-dev`/`echo-dev-mini`/`hashing-dev` priced onto those tiers; representative prod ids (`gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4`, `text-embedding-3-small`) included; unknown model → standard tier (never silently free). Conversion `micros/token = USD-per-1M × 100` documented in the file header.
- `UsageLogService.record` now derives `cost_micros` from the token counts when the caller omits one and a `model` is named (explicit cost still wins). Every existing usage caller (chat / retrieval / ingestion / voice / upload) passed model+tokens but never a cost — they all start getting costed with no caller change. A named-model cache hit (0 tokens) → explicit `cost_micros = 0`; no model named → null.
- Calibrated `packages/db/prisma/seed.ts` MATRIX: Free `ask_question` 10/mo (was 5), Plus 200/mo hard cap (was 100), Premium `limit:null` + `softLimit` 500/mo (was 1000). Added a worked margin comment in the seed.
- Documented the resolution in PRD: `> RESOLVED (M6.5)` block under §"Open Decisions" #4 (cost model, modeled-answer cost, worst-case premium analysis, seed numbers, cache-hit caveat), the decisions-table row (#4 → ✅ RESOLVED), the manifest (`[x]` M6.5 + OD#4), the pricing-table footnote ¹, and marked the M6 heading COMPLETE.
- Tests: `model-pricing.test.ts` ×6, `usage-log.service.test.ts` +4. Total 548 → 558 (api 344 → 354).

**Key decisions:**
- **Model the cost, don't just bless the numbers.** OD#4 is PM+Eng; the engineering half is the model. Building `model-pricing.ts` + deriving `cost_micros` answers OD#4's literal question ("at what volume does a premium user go cost-negative?") with code, and hands M10/M8.3 a margin signal — strictly more useful than only editing three integers.
- **softLimit 500 (degrade), not a higher hard cap.** A premium answer ≈ $0.018 → cost-negative ≈ 520 premium-model answers/mo (net ≈ $9.39). 500-then-degrade caps premium-model spend at ≈ $9.00 and drops to ≈ $0.0008/answer beyond, so the worst-case premium user is ≈ break-even, never deeply negative. A hard 500-cap-on-premium-model user would otherwise approach the whole plan price; the degrade mechanism is what makes "high fair-use cap" solvent.
- **Margin holds at a 0% cache-hit rate.** Early volume → low hit rate, so the seed math deliberately doesn't bank on caching (M6.4 is pure upside).
- **Unknown model → standard tier, not free.** A missing price entry under-reports margin rather than hiding cost entirely (safer default for a cost guard).
- Per-plan premium-model *routing* left unbuilt (only standard + degraded providers exist); the $3/$15 premium tier is a modeling assumption the cost table already prices once that model id is logged.

**Files changed:**
- `apps/api/src/observability/model-pricing.ts` — NEW: the single cost-model source (`costMicrosFor` + tiers + model map).
- `apps/api/src/observability/usage-log.service.ts` — derive `cost_micros` from token counts when omitted + a model is named.
- `apps/api/src/observability/model-pricing.test.ts` — NEW: 6 tests.
- `apps/api/src/observability/usage-log.service.test.ts` — +4 cost-derivation tests.
- `packages/db/prisma/seed.ts` — calibrated `ask_question` quotas (Free 10 / Plus 200 / Premium softLimit 500) + worked margin comment + header note.
- `project-mds/PRD.md` — OD#4 RESOLVED block + decisions-table row + manifest `[x]` + pricing footnote + M6 heading COMPLETE.

**Notes for next iteration:**
- See the "M6.5 cost-model seam" note in progress-state.md. When the real LLM/embedding driver lands, update model ids + rates + the modeled answer size in `model-pricing.ts` only — usage rows reprice automatically.
- The seed `softLimit`/`limit` are admin-tunable via the **M8.3 plan-entitlement matrix editor** (not yet built) — no deploy needed to re-tune once that ships.
- `cost_micros` is now the margin signal for M10 analytics + the M8.3 reconciliation view (sum per user/window vs `plan_prices.amountCents`).
- **M6 is COMPLETE.** Next milestone is M7 (consultation funnel) or M8 (admin/expert portals — and the matrix editor that operationalises these quotas).
- Sandbox note: the whole-monorepo `pnpm test` intermittently SIGSEGVs jest workers under memory pressure (0 assertion failures, only "suite failed to run") — confirmed all suites pass run individually / per-package; the standalone `pnpm --filter @expertos/api test` passed 354/354.

## M7.1 — Rule-based recommendation hooks (consultation funnel)
**Date:** 2026-06-01
**Ref:** PRD §"Consultation funnel" / Task Manifest M7.1

**What was done:**
- New pure, deterministic recommendation engine `@expertos/ai` `recommendation/` (`types.ts` + `evaluate.ts`): `evaluateRecommendation(signals, rules)` returns the single highest-priority fired rule (ties broken by declared trigger order) or null. Four triggers — `high_intent` (intent phrase in question), `topic` (high-stakes term in question or answer), `low_confidence` (insufficient-knowledge OR citations ≤ threshold), `depth` (assistant-turn count ≥ threshold). Keyword matching is whole-word over the shared `tokenize` (NFC+lowercase, directive §36) so VI diacritics stay whole and multi-word phrases match a contiguous run; a null/≤0 threshold never fires.
- New `apps/api/src/consultation/` module: `RecommendationService.recommend(user, input)` loads enabled `recommendation_rules` (RLS-exempt config), derives the conversation's true assistant-turn count, runs the engine, and on a fire persists a `consultation_recommendations` row + returns the wire DTO (trigger, plain-language reason, resolved consultation type). Wrapped non-fatally — any failure degrades to null so it never breaks an already-streamed answer. `ConsultationModule` (imports AuthModule) exports it.
- Wired into `ChatService.answerStream` on both terminal paths (freshly generated + cache hit); result carried on `ChatStreamEvent.done.recommendation`.
- Schema: new `recommendation_rules` table (migration `20260601030000_recommendation_rules`) on the pre-existing `recommendation_trigger` enum — one row per trigger (`@unique`), reference/config (no tenant RLS, admin-editable via M8.3). Seed adds launch defaults (high_intent 50 / low_confidence 40 thr 0 / topic 30 / depth 10 thr 4, all → `intro_call`).
- New shared contract `packages/shared/src/consultation.ts` (`RecommendationTriggerValue`, `ConsultationTypeDto`, `ConsultationRecommendationDto`).
- Added a non-Error-throw test to bring `recommendation.service.ts` branch coverage to 100%.

**Key decisions:**
- Rules are config (DB rows), not code — the funnel tunes with no deploy (mirrors `plan_entitlements`). The engine never embeds thresholds/keywords.
- Reuse the shared tokenizer for keyword matching so the funnel can't drift from the embedder/eval text pipeline.
- Non-fatal by design: the recommendation runs after the answer streamed, so a hiccup must degrade to "no prompt", never an error.
- `depth` uses the conversation's true assistant-turn count (a `message.count`), not the token-windowed prompt history.
- API + persistence only — the in-chat Book/Maybe-later/Ask-another UI + TidyCal booking are M7.2 (DTO already on the wire).

**Files changed:**
- `packages/ai/src/recommendation/{types.ts,evaluate.ts,evaluate.test.ts}` — new engine + 15 unit tests.
- `packages/ai/src/index.ts` — export `evaluateRecommendation`, `RECOMMENDATION_TRIGGERS`, rule/signal/outcome types.
- `apps/api/src/consultation/{consultation.module.ts,recommendation.service.ts,recommendation.service.test.ts}` — new service + module + 8 tests.
- `apps/api/src/chat/{chat.module.ts,chat.service.ts,chat.service.test.ts}` — import ConsultationModule, evaluate on `done` (both paths), tests.
- `packages/shared/src/{consultation.ts,index.ts,chat.ts}` — new wire types + `done.recommendation`.
- `packages/db/prisma/schema.prisma` — `RecommendationRule` model.
- `packages/db/prisma/migrations/20260601030000_recommendation_rules/migration.sql` — table + unique index + GRANT.
- `packages/db/prisma/seed.ts` — launch-default rules.

**Notes for next iteration:**
- M7.2 extends `RecommendationService`: add a `respond(user, recId, response)` + `POST /consultation-recommendations/:id/respond` (the `recommendation_response` enum already exists — add the column), build TidyCal booking off `ConsultationType.tidycalLink` (null in seed, configured later), and surface the prompt in the web chat UI from `done.recommendation`.
- Seam-tested with a mocked tx (the real `consultation_recommendations` write + `message.count` join the M11 Testcontainers list). Migration + seed were validated against a live Postgres this session — all 4 rules present with correct priority/threshold/keywords.
- Sandbox: regenerating the Prisma client with `engineType=binary` (env `PRISMA_CLIENT_ENGINE_TYPE=binary`) produced an `index.js` jest can't parse (`SyntaxError` on the inline schema) — the default **library** engine generation parses fine for jest (all api tests mock the tx, no runtime SIGILL). The seed/CLI still need the binary engine at runtime. So: default library generation for tests, binary only when actually executing Prisma queries.

## M7.2 — In-chat recommendation (Book / Maybe later / Ask another) + TidyCal booking + confirmation
**Date:** 2026-06-01
**Ref:** PRD §"Consultation funnel" / Task Manifest M7.2

**What was done:**
- **Shared (`packages/shared/src/consultation.ts`):** added `recommendationRespondSchema` (`z.enum(["book","maybe_later","ask_another"])` — excludes the un-chosen `pending` default) + `RecommendationResponseValue`, `RecommendationRespondInput`, `ConsultationBookingDto`, `RecommendationResponseResultDto`; exported from the package index. (The file now imports zod.)
- **Service (`apps/api/src/consultation/recommendation.service.ts`):** new `respond(user, recommendationId, {response})` on the existing `RecommendationService` choke point — records the response enum, and on `book` resolves the bookable consultation type server-side from the recommendation's stored trigger, creates a `consultations` row (`status: recommended`, stamped `typeId`/`amountCents`), links it back via `consultationId`, and returns `{consultationId, tidycalLink}`. Idempotent on `book` (reuses the linked consultation). Added private `resolveBookableType(tx, trigger)`.
- **Controller + module:** new thin `ConsultationRecommendationsController` (`POST /consultation-recommendations/:id/respond`, `@Roles("user")`, `ParseUUIDPipe` + `ZodValidationPipe`); registered in `ConsultationModule.controllers`.
- **Web (`apps/web/app/chat/page.tsx` + `src/lib/chat-client.ts`):** new `ConsultationPrompt` component renders Book / Maybe later / Ask another from `done.recommendation` (carried onto `UiMessage`); Book opens `booking.tidycalLink` in a new tab + confirmation, the other two dismiss. New `respondToRecommendation` client fn.
- **Tests:** +9 `recommendation.service.test.ts` (404 not-owned, maybe_later/ask_another no-consultation, book resolves+creates+links+returns link, book idempotent reuse, reuse-with-null-type, recreate-on-SetNull, fall-back-to-default-type, book-no-active-type), +5 `consultation.test.ts` (schema accept/reject). `recommendation.service.ts` 100% all metrics.
- All gates green: typecheck ✅, test ✅ (598 pass), lint ✅, deadcode ✅, build ✅.

**Key decisions:**
- The consultation type to book is **re-resolved server-side from the recommendation's stored trigger** (directive §26 — never trust a client-supplied type). The recommendation row stores only `trigger`, so `resolveBookableType` re-reads the trigger's rule for its `consultationTypeKey`, then resolves the active type (falling back to the active default).
- **Create the `consultations` row at Book-click** (status `recommended`) — it's the funnel-conversion datapoint (M10.2 attribution: question→conversation→recommendation→booking) and gives the M7.3 webhook something to flip to `booked`. Linked onto the recommendation via `consultationId`.
- **Booking idempotent** via the existing `consultationId` link — a second Book reuses it (recreates only if SetNull'd).
- **Route not entitlement-gated** — `consultation_booking` is enabled on every plan (PRD funnel table), and a route-level guard would also block `maybe_later`/`ask_another` dismissals.
- `respond` surfaces failures as real HTTP errors (unlike `recommend`, which degrades to null after a streamed answer) — it runs on an explicit user action, not after delivery.

**Files changed:**
- `packages/shared/src/consultation.ts` — respond schema + result DTOs (+ zod import); `packages/shared/src/index.ts` — exports.
- `apps/api/src/consultation/recommendation.service.ts` — `respond` + `resolveBookableType`; class JSDoc.
- `apps/api/src/consultation/consultation-recommendations.controller.ts` — NEW (respond route).
- `apps/api/src/consultation/consultation.module.ts` — register the controller.
- `apps/web/app/chat/page.tsx` — `ConsultationPrompt`, recommendation on `UiMessage`, render under the answer.
- `apps/web/src/lib/chat-client.ts` — `respondToRecommendation`.
- `apps/api/src/consultation/recommendation.service.test.ts` + `packages/shared/src/consultation.test.ts` — tests.
- `project-mds/PRD.md` — M7.2 → [x].

**Notes for next iteration:**
- **M7.3 (next): resolve OD#10 — TidyCal webhook reliability / missed-event recovery.** Wire the TidyCal webhook to flip the M7.2-created `consultations` row to `booked` (record `bookingRef`/`scheduledAt`) when the user completes booking, + missed-event recovery. **Mirror the M6.2 Stripe webhook discipline:** `@Public()` raw-body route, signature/secret verify, idempotent upsert keyed on the TidyCal booking id, sync in a system-RLS context (`applyRlsContext({isAdmin:true})` — the booking has no request principal). Correlation back to user/recommendation is the reliability crux (TidyCal links are static — match by booking email or a reference). `ConsultationType.tidycalLink` is still null in the seed (real link configured later, like the Stripe `provider_price_id`).
- Seam-tested with a mocked tx — the real `consultations` write + the `consultationId` link join the M11 Testcontainers list (same caveat as the other stores).
- Web chat UI now consumes `done.recommendation`; the deferred consumer-web pages (entitlements/usage, history/saved-answers/search/feedback, upload UI) remain open.

## M7.3 — Resolve Open Decision #10: TidyCal webhook reliability / missed-event recovery
**Date:** 2026-06-01
**Ref:** PRD §"Consultation funnel" (M7.3) + §"Open Decisions" #10

**What was done:**
- Closed M7 (consultation funnel). Wired the booking-confirmation path that flips the M7.2-created `consultations` row from `recommended` → `booked` (records `bookingRef`/`scheduledAt`) when the user completes the TidyCal booking — the booking analog of the M6.2 Stripe webhook, mirroring its discipline.
- **Provider seam** (`apps/api/src/consultation/`): `TidyCalProvider` interface + `BookingEvent`/`BookingWebhookVerificationError`/`statusForBookingEvent` (`tidycal-provider.ts`); `OfflineTidyCalProvider` (trusted-JSON envelope, no signing); `HttpTidyCalProvider` (HMAC-SHA256 raw-body verify via `node:crypto`, event parse with a TidyCal event-name map, `listBookings` REST poll through an injectable `TidyCalHttpClient`); `TIDYCAL_PROVIDER` token + `createDefaultTidyCalProvider` factory (swaps the real driver when `TIDYCAL_WEBHOOK_SECRET` is set; `TIDYCAL_API_TOKEN` enables the poll).
- **`BookingService`** (`booking.service.ts`): `handleWebhook(req)` verifies (→400 on bad sig), parses (unmodeled type → no-op), idempotently syncs in a system RLS context (`runAsSystem` = `applyRlsContext({tenantId:GLOBAL, isAdmin:true})`); `reconcile({since?})` polls TidyCal (default 24h lookback) and replays each booking through the same idempotent apply = missed-event recovery, returning `{polled, applied, matched, skipped}`.
- **`ConsultationBookingsController`**: `POST /consultation-bookings/webhook` (`@Public()`, reads `req.rawBody` + `tidycal-signature`) + `POST /consultation-bookings/reconcile` (`@Roles("admin")`). Wired both + the provider into `ConsultationModule`.
- **Schema:** new `booking_webhook_events` table (migration `20260601040000`) — RLS-exempt config/system table, unique `[provider, event_id]` (idempotency), index on `booking_ref` (correlation). Validated against live Postgres (table + unique + indexes present, RLS disabled, app_user grants). Regenerated the Prisma client.
- **Shared:** `bookingReconcileSchema` + `BookingReconcileInput`/`BookingReconcileResultDto` (`packages/shared/src/consultation.ts`, exported from index).
- **Tests (+36):** `booking.service.test.ts` ×16 (verify→400, rethrow, no-op, link-by-bookingRef, cancellation-keeps-scheduledAt, flip-pending, flip-pending-keeps-scheduledAt, create-outside-funnel, unmatched-warns, no-email-skips-lookup, idempotent-redelivery, P2002-race, non-unique-rethrow + reconcile ×3), `offline-tidycal-provider.test.ts` ×7, `http-tidycal-provider.test.ts` ×10, `consultation.test.ts` (shared) ×3. `booking.service.ts` 100% all metrics.

**Key decisions:**
- **Idempotency via a dedicated `booking_webhook_events` ledger, not a column on `consultations`.** Billing reused the natural `transactions` unique, but a booking that matches no user can't create a consultation row — yet it must still be recorded so it doesn't silently vanish (the OD#10 no-vanish requirement). The ledger doubles as the recovery audit trail (`matched=false` rows await admin reconcile).
- **Correlation order `bookingRef` → email → create.** TidyCal links are static so the event doesn't identify the consultation. Match a follow-up by `bookingRef`, else the booking email → the user's most-recent pending `recommended` consultation (the M7.2 row), else create a `booked` consultation for an out-of-funnel booking. An email matching no user is kept `matched=false`.
- **Reconcile uses a synthetic `reconcile:<bookingRef>:<type>` eventId** so re-polling is idempotent against the same ledger, without colliding with real webhook event ids (a created-then-cancelled booking would collide if keyed on the bare booking id).
- **Offline-default + real-driver-behind-a-token** mirrors `PAYMENT_PROVIDER`/`STORAGE_PROVIDER`/`EMBEDDING_PROVIDER` — keeps the whole path runnable in CI/local without TidyCal.
- **`consultations.status` is the user-facing pending state** (`recommended`→`booked`→`canceled`); no separate confirmation flag.

**Files changed:**
- `packages/db/prisma/schema.prisma` — new `BookingWebhookEvent` model.
- `packages/db/prisma/migrations/20260601040000_booking_webhook_events/migration.sql` — new table + unique + index + grant.
- `apps/api/src/consultation/tidycal-provider.ts` — provider interface, `BookingEvent`, error, status map (new).
- `apps/api/src/consultation/offline-tidycal-provider.ts` + `.test.ts` — offline default (new).
- `apps/api/src/consultation/http-tidycal-provider.ts` + `.test.ts` — real TidyCal driver (new).
- `apps/api/src/consultation/tidycal.tokens.ts` + `tidycal.defaults.ts` — DI token + composition root (new).
- `apps/api/src/consultation/booking.service.ts` + `.test.ts` — webhook/reconcile sync (new).
- `apps/api/src/consultation/consultation-bookings.controller.ts` — webhook + reconcile routes (new).
- `apps/api/src/consultation/consultation.module.ts` — wired controller + service + provider.
- `packages/shared/src/consultation.ts` + `index.ts` — reconcile schema + DTOs.
- `packages/shared/src/consultation.test.ts` — schema tests.
- `project-mds/PRD.md` — M7/M7.3 + OD#10 marked resolved (manifest, table, RESOLVED block).

**Notes for next iteration:**
- **M7 is COMPLETE.** Next major milestone is **M8 — Admin & Expert portals** (apps/admin is bare): plan-entitlement matrix editor (M8.3 — tunes M6.5 quotas + soft thresholds + M7.1 `recommendation_rules`), revenue reports over `transactions` + `cost_micros`, failed/low-confidence inspector over `answer_feedback`, versioned-publish + conversation-to-knowledge pipelines (M8.1/M8.2), expert portal (M8.5). The **manual TidyCal reconcile** + unmatched `booking_webhook_events` (`matched=false`) want an admin surface there too.
- **Verify the TidyCal payload shapes against real docs when wiring the live account** — `EVENT_NAME_MAP` + `toBookingEvent` + the `/bookings` poll response are best-effort structural guesses (adjust only those). The `HttpTidyCalProvider` REST poll needs live network (deploy-time, like the Stripe `FetchStripeHttpClient`).
- Seam-tested with a mocked tx — the real `booking_webhook_events`/`consultations` writes join the M11 Testcontainers list; the migration was validated against live Postgres this session.
- The deferred consumer-web pages (entitlements/usage, history/saved-answers/search/feedback, upload UI) remain open in parallel.

## M8.1 (API) — Knowledge versioned-publish + expert-review gate
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest M8.1; PRD §"Admin & Expert portals" / §"Data Model" (publish lifecycle)

**What was done:**
- Built the knowledge publish-workflow API — the architectural core of M8 and the integration point between the M1.1 ingestion drafts and M1.2 retrieval. New `apps/api/src/knowledge/` module (`KnowledgeService` + `KnowledgeController` + `KnowledgeModule`), wired into `AppModule`.
- `KnowledgeService` is a state machine over the shared `publish_status` enum: `draft → expert_review → published` (`request-changes` → `draft`), `published → archived`. Invalid transitions → `ConflictException` (409); missing version/document → `NotFoundException` (404).
- `approve` (the expert-review gate) flips the version's chunks `pending → published` (retrieval-visible), points `document.publishedVersionId` at it + sets `document.status = published`, and **supersedes the prior published version** (archives its row + chunks) so retrieval never returns two generations. `archive` reverses it for a live version (chunks → archived; clears the document pointer + marks archived when it was the live one). `approve` stamps `approvedBy`/`approvedAt`.
- `KnowledgeController` (`@Roles("expert")`): `GET /knowledge/documents` (review queue, status/scope filter), `GET /knowledge/documents/:id` (version history), `POST /knowledge/versions/:versionId/{submit,approve,request-changes,archive}`.
- Shared contracts: `packages/shared/src/knowledge.ts` — `knowledgeListQuerySchema` + `KnowledgeVersionDto`/`KnowledgeDocumentDto`/`KnowledgeDocumentDetailDto` (exported from the index, DTOs in shared so the admin UI can consume them).
- Tests: `knowledge.service.test.ts` (16 cases — every transition, the supersede + chunk-visibility side effects, the conflict/404 paths) → `knowledge.service.ts` 100% lines/stmts/funcs, 96.4% branch (≥90 gate). `knowledge.test.ts` (4 cases — schema defaults/coercion/caps/enum).

**Key decisions:**
- API-first, marked `[~]` not `[x]`: the admin UI (the `.shell`, status `.badge` tones, the publish queue) is the open follow-up — consistent with how every milestone here shipped (M2.3 voice routes before the M8.5 portal; M3.2–M3.4 API before UI). Building the bare `apps/admin` shell + Firebase admin auth + an API client is a substantial, lower-risk frontend slice best done as its own task; the risky/architectural core (the state machine + the retrieval-visibility integration) is what this task delivered.
- Chunk-visibility flip + prior-version supersede live ONLY in `approve`/`archive` (the gate), never in ingestion — ingestion always produces drafts (`DocumentVersionRepository.store({publish:false})`). The seed/CLI `{publish:true}` path remains the only short-circuit publisher (for seeding).
- `document.status` mirrors the latest version's status; `publishedVersionId` independently tracks the live generation — so a doc can serve v2 while v3 is being drafted.
- Role-gated (`expert`+) + RLS tenant isolation, NO per-expert ownership assertion — knowledge is tenant/scope-scoped, unlike voice profiles which tie to an expert's `userId`. Any expert in the tenant reviews/publishes.
- Upload-to-create-a-draft reuses the existing `IngestionService.ingest({publish:false})` — no new ingest path was added.

**Files changed:**
- `packages/shared/src/knowledge.ts` — NEW: list-query schema + 3 DTOs for the publish workflow.
- `packages/shared/src/knowledge.test.ts` — NEW: 4 schema tests.
- `packages/shared/src/index.ts` — export the new schema + DTO types.
- `apps/api/src/knowledge/knowledge.service.ts` — NEW: the publish-workflow state machine + chunk-visibility/document-pointer integration.
- `apps/api/src/knowledge/knowledge.controller.ts` — NEW: `@Roles("expert")` routes for the review queue + version lifecycle.
- `apps/api/src/knowledge/knowledge.module.ts` — NEW: module wiring (imports `AuthModule` for `RlsService`).
- `apps/api/src/knowledge/knowledge.service.test.ts` — NEW: 16 service tests.
- `apps/api/src/app.module.ts` — register `KnowledgeModule`.

**Notes for next iteration:**
- **Immediate follow-up = the M8.1 admin UI** on this API (`/knowledge` routes). `apps/admin` is still bare — needs the shared `.shell`, Firebase admin auth, an admin API client (mirror `apps/web/src/lib`), the review queue + version-history detail with status `.badge` tones, and the Submit/Approve/Request-changes/Archive actions. That closes M8.1.
- **M6.4 publish-time cache invalidation** now has its clean hook: clear the in-process caches + `deleteMany` the tenant's `semantic_cache` rows inside `KnowledgeService.approve`/`archive`.
- **M8.2 conversation-to-knowledge** (`knowledge_drafts`) reuses this publish gate — a promoted draft becomes a `document_version` that flows through the same `submit`/`approve`.
- **Seam-tested with a mocked tx** — the real `document`/`document_version`/`chunk` writes + the chunk-visibility `updateMany` (and the retrieval-visibility behavior end-to-end) join the M11 Testcontainers list.
- **Sandbox test caveat:** the full parallel `pnpm test` could not complete this session — the native Prisma engine SIGILLs ~1 random jest worker per process and ts-jest intermittently falls back to a babel transform that can't parse `type` imports (the documented aarch64/linuxkit quirk; restart the session for a clean parallel run). All counts were confirmed per-suite/per-file in isolated runs with zero assertion failures (api 423, shared 76); typecheck/lint/knip/build all pass.

## M8.2 — Conversation-to-knowledge pipeline (API)
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" (Task Manifest M8.2)

**What was done:**
- New `KnowledgeDraftService` (`apps/api/src/knowledge/knowledge-draft.service.ts`) — the single choke point for the `knowledge_drafts` lifecycle: `create` ("Mark valuable"), `list`/`get`, `update` (edit only while `draft`), `submit`/`requestChanges`/`reject` (status moves over `KnowledgeDraftStatus`: `draft → expert_review → published`; `request-changes`→`draft`; `draft|expert_review → rejected`), and `publish` (the gate).
- `publish` ingests the draft text into the knowledge base via `IngestionService.ingest({publish:true})` under a unique `draft://<id>` source URI → a fresh published `document` + retrieval-visible chunks. Idempotent: a `draft://<id>` document existence pre-check skips re-ingestion on a partial-failure retry (the only retrieval-drift risk). An `EmptyDocumentError` maps to `400` and leaves the draft unpublished.
- `create` re-checks an optional source `conversationId` under RLS (404 if invisible/foreign) before storing; content is client-supplied (the admin UI assembles the Q&A) and stored verbatim.
- New `KnowledgeDraftController` (`@Roles("expert")`): `POST /knowledge-drafts`, `GET /knowledge-drafts`, `GET/PATCH /knowledge-drafts/:id`, `POST /knowledge-drafts/:id/{submit,request-changes,reject,publish}`. Wired into `KnowledgeModule` (which now `imports: [IngestionModule]`).
- New shared contracts in `packages/shared/src/knowledge.ts`: `knowledgeDraftStatusSchema`, `knowledgeDraftCreate/Update/ListQuerySchema`, `KnowledgeDraftSummaryDto` (content-free, list) / `KnowledgeDraftDto` (with content, detail). Exported from the shared index.
- Schema: added a `language Language @default(en)` column to `KnowledgeDraft` + migration `20260601050000_knowledge_draft_language` so a VI draft publishes as VI knowledge; regenerated the Prisma client.
- Tests: 18 service tests (`knowledge-draft.service.test.ts`) + 11 shared schema tests (`knowledge.test.ts`).

**Key decisions:**
- The knowledge_draft's **own** review is the expert-review gate (its dedicated status enum mirrors the publish lifecycle). On publish, ingest with `publish:true` (a fresh unique-URI document → no supersede needed; consistent with the seed/CLI publisher precedent), rather than routing through `KnowledgeService.approve` (which requires an `expert_review` *document version* — awkward to drive programmatically and would create a draft document version requiring a second review).
- Idempotency via the `draft://<id>` existence pre-check is the minimal guard for the only drift window (a crash between ingest and the status flip) without refactoring `IngestionService` to share a transaction.
- API + persistence only; the admin UI (draft review queue + "Mark valuable" from the conversation viewer) is the open follow-up — same precedent as M8.1/M3.2.
- `expertId` on the table is left unused (documents have no expert link); reserved for future expert-authored attribution.

**Files changed:**
- `packages/db/prisma/schema.prisma` — added `language` to `KnowledgeDraft`.
- `packages/db/prisma/migrations/20260601050000_knowledge_draft_language/migration.sql` — new (ADD COLUMN).
- `packages/shared/src/knowledge.ts` — draft DTOs + schemas (imports `languageSchema`).
- `packages/shared/src/index.ts` — export the new draft schemas/types.
- `packages/shared/src/knowledge.test.ts` — +11 schema tests.
- `apps/api/src/knowledge/knowledge-draft.service.ts` — new service.
- `apps/api/src/knowledge/knowledge-draft.controller.ts` — new controller.
- `apps/api/src/knowledge/knowledge-draft.service.test.ts` — new, 18 tests.
- `apps/api/src/knowledge/knowledge.module.ts` — register the service/controller + import `IngestionModule`.

**Notes for next iteration:**
- **Admin UI is the open M8.2 follow-up** (with M8.1's): build the draft review queue + draft detail/edit + "Mark valuable" action on `apps/admin` (still bare) — needs Firebase admin auth + an admin API client (none yet; mirror `apps/web/src/lib`).
- **Publish-time cache invalidation** (M6.4 follow-up) applies to `publish` too — clear in-process caches + `deleteMany` the tenant's `semantic_cache` rows after `ingest`.
- **No live DB this session** — the migration SQL (a single additive enum column mirroring the init-schema pattern) was authored but not `migrate deploy`'d/validated against Postgres; do that when a DB is available. The service is seam-tested with a mocked tx (M11 Testcontainers list).
- `Document` has no per-expert link, so a published draft is tenant/scope-scoped knowledge only; if expert attribution is ever needed, that's a schema change on `documents`.

## M8.1 + M8.2 — Admin UI (knowledge publish-workflow + draft review portal)
**Date:** 2026-06-01
**Ref:** PRD M8.1, M8.2 (§"Admin & Expert portals"; §"Design System") — closes the UI halves of the two APIs

**What was done:**
- Turned `apps/admin` from a bare scaffold into a real Next App-Router portal on the existing M8.1/M8.2 APIs.
- **Lib layer (mirrors `apps/web/src/lib`):**
  - `src/lib/firebase.ts` + `src/lib/auth-context.tsx` — verbatim copies of web's (lazy Firebase client, `AuthProvider`/`useAuth`, Google sign-in, `getIdToken`).
  - `src/lib/admin-client.ts` — typed fetch wrapper (Bearer ID token, surfaces `{message}`/`{reason}` API error body): `listDocuments`/`getDocument`/`versionAction` (M8.1) + `listDrafts`/`getDraft`/`updateDraft`/`draftAction` (M8.2).
  - `src/lib/status-tone.ts` — single status→`.badge`-tone mapper (`publishStatusTone`/`draftStatusTone`/`statusLabel`): published→green, expert_review→amber, rejected→red, neutral→ink/info.
- **Frame:** `src/components/AdminFrame.tsx` — Design-System `.shell` (`Shell`/`Topbar`/`Content` primitives) with an ink sidebar of review queues (active-route highlight), gated on Firebase auth (sign-in screen when signed out).
- **Pages:** `/` (queue landing cards), `/knowledge` (M8.1 status-filtered review queue), `/knowledge/[id]` (version-history detail + Submit/Approve/Request-changes/Archive), `/knowledge-drafts` (M8.2 draft queue), `/knowledge-drafts/[id]` (draft detail/edit — editable only while `draft` — + Submit/Publish/Request-changes/Reject).
- Added `@expertos/shared` + `firebase` deps to `apps/admin/package.json`; layout wraps `AuthProvider`.

**Key decisions:**
- Mirrored web's `firebase.ts`/`auth-context.tsx` rather than extracting a shared package — the two are independent Next apps with separate bundles; the lazy-init pattern is what keeps `next build` working without creds.
- Status→tone centralized in `status-tone.ts` (not inline per page) so badge semantics are single-sourced across both queues.
- "Mark valuable" (`POST /knowledge-drafts`) intentionally NOT built — it's a conversation-viewer action and no admin conversation viewer exists yet; adding an unused client fn would fail knip.
- Auth in the UI is a UX gate only; the security boundary stays server-side (`@Roles("expert")`/`@Roles("admin")` + RLS). A non-expert who signs in sees the queues but every call 403s (shown as the page error badge).
- No page tests — consistent with `apps/web` (the repo has no Next page tests); gates are typecheck/lint/build/knip.

**Files changed:**
- `apps/admin/package.json` — add `@expertos/shared`, `firebase` deps.
- `apps/admin/app/layout.tsx` — wrap children in `AuthProvider`.
- `apps/admin/app/page.tsx` — landing with queue cards inside `AdminFrame`.
- `apps/admin/app/knowledge/page.tsx`, `apps/admin/app/knowledge/[id]/page.tsx` — M8.1 queue + version-history detail.
- `apps/admin/app/knowledge-drafts/page.tsx`, `apps/admin/app/knowledge-drafts/[id]/page.tsx` — M8.2 queue + detail/edit.
- `apps/admin/src/lib/{firebase.ts,auth-context.tsx,admin-client.ts,status-tone.ts}`, `apps/admin/src/components/AdminFrame.tsx` — new lib + frame.

**Notes for next iteration:**
- M8.5 (expert portal) = the same `AdminFrame` + the M2.3 `/voice-profiles` routes + consultation-conversion views over the M7 funnel; M8.3 (matrix/rules editors, revenue reports, query inspector) needs **new API routes first** (none exist for plan-entitlement editing / revenue aggregation / `answer_feedback` admin reads) — build the route, then the page.
- The admin TidyCal **reconcile** (`POST /consultation-bookings/reconcile`) + unmatched `booking_webhook_events` (`matched=false`) want a surface here too; `admin-client.ts` is the place to add it.
- Build artifact note: `apps/admin/.next/standalone` causes a harmless jest-haste "naming collision" warning (web has the same) — the artifact is gitignored.
- Verify the portal end-to-end once Firebase creds + a live API/DB are available (this session has neither; build/typecheck/lint/knip all pass).

## M8.3 (partial) — Admin revenue reports
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" → "Revenue: transaction ledger + basic revenue reports"; PRD M8.3

**What was done:**
- New `apps/api/src/revenue/` module (the module the PRD §"Paywall" key-files list names): `RevenueService` + `RevenueController` + `RevenueModule`, wired into `AppModule`.
- `GET /admin/revenue/report?months=` (`@Roles("admin")`) → a platform-wide `RevenueReportDto`: current MRR, active subscribers, per-plan breakdown, trailing monthly ledger series, window gross/refunded/net, AI `cost_micros`, and a derived `marginCents`.
- New shared `packages/shared/src/revenue.ts` (`revenueReportQuerySchema` + `RevenueReportDto`/`RevenueByPlanDto`/`RevenuePeriodDto`), exported from the shared index.
- Admin UI: `apps/admin/app/revenue/page.tsx` (Stat KPI cards + by-plan + by-month tables, window selector), `getRevenueReport` in `admin-client.ts`, nav entry in `AdminFrame`, home card.
- Tests: `revenue.service.test.ts` (5, 100% coverage) + `revenue.test.ts` shared schema (4).

**Key decisions:**
- Took the **revenue-reports** sub-task of M8.3 first (fail-fast: it's the new module + the riskiest aggregation/raw-SQL + BigInt work, and it's read-only so safe). The other three M8.3 sub-deliverables (plan-entitlement matrix editor, recommendation-rules editor, failed-query inspector) remain open — M8.3 stays `[~]`.
- **Admin cross-tenant reads via the admin RLS context** (`RlsService.run` under an admin principal → `is_admin` GUC), reusing the conversation-search precedent — no `tenant_id` predicate. The `@Roles("admin")` route guard is what guarantees the caller is an admin.
- **MRR via Prisma `groupBy` + `plan_prices`** (testable, no raw SQL); **raw `$queryRawUnsafe` only for the `date_trunc('month')` time-series** (Prisma can't express it — the M3.3 search precedent). Yearly prices normalized to monthly (÷12).
- **`BigInt` → `Number()` coercion** on every raw `sum`/`count` (Postgres returns aggregates as BigInt; the existing `ts_rank` float path never hit this).
- Refunds summed with `abs()` so a stored sign convention can't flip the net total. Money in integer cents; AI cost kept in `cost_micros` on the wire for precision.

**Files changed:**
- `packages/shared/src/revenue.ts` (new) + `packages/shared/src/index.ts` — DTOs + schema + exports.
- `apps/api/src/revenue/{revenue.service,revenue.controller,revenue.module}.ts` (new) + `apps/api/src/app.module.ts` — module wiring.
- `apps/admin/app/revenue/page.tsx` (new), `apps/admin/app/page.tsx`, `apps/admin/src/components/AdminFrame.tsx`, `apps/admin/src/lib/admin-client.ts` — admin UI + client + nav.
- `apps/api/src/revenue/revenue.service.test.ts` (new), `packages/shared/src/revenue.test.ts` (new).

**Notes for next iteration:**
- **Seam-tested with a mocked tx** — the real `date_trunc`/`FILTER` aggregate, the BigInt round-trip, and the admin cross-tenant RLS visibility need the M11 Testcontainers pass (the standing raw-SQL caveat shared with `PgVectorStore`/conversation-search). No live DB this session.
- Remaining M8.3: the **failed-query inspector** is the easiest next slice (read-only `answer_feedback`, copy the `RevenueService` admin-RLS pattern). The **matrix/rules editors** are the mutation surfaces — new write routes over `plan_entitlements`/`recommendation_rules` (RLS-exempt config) first, then the page + `admin-client.ts` `update*` fns (don't add a client fn before its page or knip fails).
- Full `apps/api` parallel suite ran clean this session (53 suites / 446) — no SIGILL this run.

## Publish-time cache invalidation (M6.4 / M8 follow-up)
**Date:** 2026-06-01
**Ref:** PRD M6.4 (caching) + M8.1/M8.2 (publish workflow); the standing follow-up flagged across the M6.4/M8.1/M8.2 seam notes ("publish-time invalidation is the M8 follow-up")

**What was done:**
- Closed the known staleness gap: a knowledge publish/archive left the M6.4 caches serving stale answers/retrieval until the TTL aged out.
- New `LruCache.deletePrefix(prefix): number` — drops every entry whose key starts with `prefix`, returns the count. Used to prune one tenant's entries (keys are `\n`-delimited segment composites prefixed `retrieval\n<tenantId>\n` / `answer\n<tenantId>\n`), so a publish in one tenant never cold-starts another tenant's hot cache.
- New `ResponseCacheService.invalidateTenant(user)` — prunes both in-process LRUs by tenant prefix + `deleteMany`s the tenant's `semantic_cache` rows. The `deleteMany` carries an **explicit `tenantId` predicate** (an admin/expert actor runs with `is_admin` GUC set → an unscoped delete under RLS would clear every tenant's cache).
- Wired it post-commit into `KnowledgeService.approve` (chunks flip live), `KnowledgeService.archive` (chunks leave retrieval), and `KnowledgeDraftService.publish` (new live knowledge). `KnowledgeModule` now `imports: [CacheModule]`.

**Key decisions:**
- Per-tenant prefix prune over a global cache `clear()` — one tenant's publish shouldn't evict every tenant's hot entries.
- Invalidate **after** the transaction commits (a rolled-back/rejected publish must not drop the cache); the narrow commit→invalidate race is already bounded by the TTL.
- Fire on `KnowledgeDraftService.publish` even on the idempotent retry (already-ingested branch), so a crash between ingest and the status flip can't leave the cache un-invalidated.
- Kept the explicit `tenantId` predicate on the semantic delete (matches the store's own writes; required for admin-context correctness).

**Files changed:**
- `apps/api/src/cache/lru-cache.ts` — added `deletePrefix`.
- `apps/api/src/cache/response-cache.service.ts` — added `invalidateTenant`.
- `apps/api/src/knowledge/knowledge.service.ts` — inject `ResponseCacheService`; invalidate after `approve`/`archive` commit.
- `apps/api/src/knowledge/knowledge-draft.service.ts` — inject `ResponseCacheService`; invalidate after `publish`.
- `apps/api/src/knowledge/knowledge.module.ts` — `imports: [CacheModule]`.
- Tests: `lru-cache.test.ts` (+1 deletePrefix), `response-cache.service.test.ts` (+2 invalidateTenant: drops own / spares peer), and invalidation assertions added to the existing approve/archive/publish service tests (incl. the rejected-transition no-invalidate cases). Harnesses updated to pass a mocked `ResponseCacheService`.

**Notes for next iteration:**
- Seam-tested with a mocked tx — the real `semantic_cache` `deleteMany` under RLS joins the M11 Testcontainers list (the standing raw-SQL/store caveat).
- The retrieval-layer key (`retrieval\n<tenant>\n…`) is invalidated too even though publish only changes *published* chunks — coarse but safe; a finer scope (only the affected document's queries) isn't worth the complexity for an in-process hot cache.
- No new wiring needed for future publishers as long as they route through `KnowledgeService`/`KnowledgeDraftService` (the documented single choke points).

## M8.3 (partial) — Admin plan-entitlement matrix editor
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" → "Plan-entitlement matrix editor" (Task Manifest M8.3)

**What was done:**
- New `EntitlementMatrixService` (`apps/api/src/entitlements/entitlement-matrix.service.ts`) — the single write choke point over the `plan_entitlements` config table. `getMatrix(user)` returns every plan × feature + populated cells; `updateCell(user, planId, featureId, input)` upserts one cell by the `[planId, featureId]` natural key.
- New `EntitlementAdminController` (`@Roles("admin")`): `GET /admin/entitlements`, `PATCH /admin/entitlements/:planId/features/:featureId` (ParseUUIDPipe + ZodValidationPipe). Wired into `EntitlementsModule.controllers` + providers.
- New shared contract in `packages/shared/src/entitlements.ts` (now imports zod): `usageWindowSchema`, `entitlementUpdateSchema`, and DTOs `EntitlementMatrixDto`/`EntitlementMatrixPlanDto`/`EntitlementMatrixFeatureDto`/`EntitlementCellDto`/`EntitlementUpdateInput`/`UsageWindowValue`. Exported from the index.
- New admin UI `apps/admin/app/entitlements/page.tsx` — plan × feature matrix table; per-cell `CellEditor` (enable checkbox; metered features add hard-limit/soft-limit/window inputs) with a per-cell Save. New `getEntitlementMatrix`/`updateEntitlementCell` in `admin-client.ts`; "Entitlements" nav entry in `AdminFrame`.
- Tests: +9 service (`entitlement-matrix.service.test.ts`), +8 shared schema (`entitlements.test.ts`).

**Key decisions:**
- Per-cell PATCH over a bulk matrix POST: each save is atomic and its validation error stays local to the cell.
- Type-coherence + cross-field validation lives in the service, not the schema — the zod schema can't see the feature type. Boolean features force metered fields to null (§4.20); incoherent metered configs (softLimit ≥ limit, or a quota with no window) → 400.
- Identity is taken only from the path, never the body (§4.7) — a save can't reassign a cell to a different plan/feature.
- Ran inside `RlsService.run` under the admin principal for the transaction + consistency with `RevenueService`, even though `plan_entitlements`/`plans`/`features` are RLS-exempt config (so the admin GUC is irrelevant to isolation here).
- No cache invalidation: changing entitlements affects quotas/access on the next `EntitlementService` read, but not cached *answers* (the answer cache key already pins the model tier; answer content doesn't depend on the plan).

**Files changed:**
- `packages/shared/src/entitlements.ts` — added zod schemas + matrix DTOs.
- `packages/shared/src/index.ts` — exported the new schemas/types.
- `apps/api/src/entitlements/entitlement-matrix.service.ts` — new write service.
- `apps/api/src/entitlements/entitlement-admin.controller.ts` — new admin controller.
- `apps/api/src/entitlements/entitlements.module.ts` — registered the controller + service.
- `apps/api/src/entitlements/entitlement-matrix.service.test.ts` — new service tests.
- `packages/shared/src/entitlements.test.ts` — new schema tests.
- `apps/admin/src/lib/admin-client.ts` — `getEntitlementMatrix`/`updateEntitlementCell`.
- `apps/admin/app/entitlements/page.tsx` — new matrix editor page.
- `apps/admin/src/components/AdminFrame.tsx` — "Entitlements" nav entry.

**Notes for next iteration:**
- The remaining M8.3 sub-deliverables: **recommendation-rules editor** (`recommendation_rules`, another mutation surface — follow this `EntitlementMatrixService` write template: identity-from-path, server-side coherence validation, RLS-exempt config) and **failed/low-confidence query inspector** over `answer_feedback` (read-only — the easiest remaining; copy the `RevenueService` admin cross-tenant RLS pattern).
- The real `plan_entitlements` upsert joins the M11 Testcontainers list (seam-tested with a mocked tx this session; no live DB).

## M8.3 (partial) — Admin recommendation-rules editor
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" → M8.3 (recommendation-rules editor sub-deliverable)

**What was done:**
- New `RecommendationRulesService` (`apps/api/src/consultation/recommendation-rules.service.ts`) — the single write choke point over the `recommendation_rules` config table. `getRules(user)` returns every rule (highest priority first) + the consultation types a rule can point at; `updateRule(user, trigger, input)` upserts one rule keyed by its trigger. Runs inside `RlsService.run` under the admin principal (config tables are RLS-exempt). Mirrors the `EntitlementMatrixService` write template.
- Server-side coherence (directive §4.20): a keyword trigger (`topic`/`high_intent`) has its `threshold` forced `null`; a threshold trigger (`depth`/`low_confidence`) has its `keywords` forced `[]`. An *enabled* rule that could never fire is rejected (400): a keyword rule with no keywords, a threshold rule with a null threshold, a `depth` rule with threshold < 1. A non-null `consultationTypeKey` is validated to reference an existing consultation type (400 if unknown). `kind` (keyword vs threshold) is derived from the trigger.
- New `RecommendationRulesController` (`@Roles("admin")`): `GET /admin/recommendation-rules` + `PATCH /admin/recommendation-rules/:trigger` (identity from the path via `ZodValidationPipe(recommendationTriggerSchema)`, body via `ZodValidationPipe(recommendationRuleUpdateSchema)`). Registered in `ConsultationModule` (controller + provider).
- New shared `recommendationTriggerSchema` + `recommendationRuleUpdateSchema` + `RecommendationRuleDto`/`RecommendationConsultationTypeDto`/`RecommendationRulesDto`/`RecommendationRuleUpdateInput` (`packages/shared/src/consultation.ts`), exported from the index.
- Admin UI: new `apps/admin/app/recommendation-rules/page.tsx` — one row per rule with a `RuleEditor` (enable checkbox; keyword triggers show a one-per-line keyword `Textarea`, threshold triggers a numeric `Input`; both show priority + a consultation-type `Select`); per-rule Save PATCHes and folds the persisted rule back in, surfacing the server's coherence error inline. New `getRecommendationRules`/`updateRecommendationRule` in `admin-client.ts`; "Funnel rules" nav entry in `AdminFrame`.

**Key decisions:**
- Per-rule PATCH (not a bulk matrix POST) keeps each save atomic and the error local — the matrix-editor precedent.
- Coherence validation lives in the service (cross-field, trigger-dependent) rather than the schema — the Zod schema can't see which field a given trigger actually uses.
- No cache invalidation: recommendation rules aren't cached (read per chat turn through `RecommendationService.recommend`), unlike the answer/retrieval caches.
- The four triggers are a fixed enum, so the editor edits existing rows (upsert covers a missing seed row); the trigger is the identity, validated by the enum schema on the path.

**Files changed:**
- `packages/shared/src/consultation.ts` — added the M8.3 recommendation-rules editor schemas + DTOs.
- `packages/shared/src/index.ts` — exported the new schemas + types.
- `packages/shared/src/consultation.test.ts` — +10 schema tests (trigger enum + rule update defaults/trim/bounds).
- `apps/api/src/consultation/recommendation-rules.service.ts` — new write choke point.
- `apps/api/src/consultation/recommendation-rules.controller.ts` — new admin controller.
- `apps/api/src/consultation/recommendation-rules.service.test.ts` — +10 service tests.
- `apps/api/src/consultation/consultation.module.ts` — registered the controller + service; updated the module doc.
- `apps/admin/src/lib/admin-client.ts` — `getRecommendationRules`/`updateRecommendationRule`.
- `apps/admin/src/components/AdminFrame.tsx` — "Funnel rules" nav entry.
- `apps/admin/app/recommendation-rules/page.tsx` — new editor page.

**Notes for next iteration:**
- The last open M8.3 sub-deliverable is the **failed/low-confidence query inspector** over `answer_feedback` (read-only — the easiest remaining). Copy the `RevenueService`/`EntitlementMatrixService` admin cross-tenant RLS pattern: run under the admin principal so the `is_admin` GUC reads all tenants (no `tenant_id` predicate); add a read-only API route, then a page. `answer_feedback` has no `conversationId` column, so join through `messages` to surface the question/answer text + the 👎 reason.
- The real `recommendation_rules` upsert joins the M11 Testcontainers list (seam-tested with a mocked tx this session; no live DB).
- After the query inspector, M8.3 closes and M8.4 (manage users/subs/experts/voice + audit logs + user-data deletion) / M8.5 (expert portal) are the next M8 milestones.

## M8.3 — Admin failed/low-confidence query inspector
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" → M8.3 (the last open M8.3 sub-deliverable)

**What was done:**
- New `apps/api/src/feedback-inspector/` module (`FailedQueryService` + `FailedQueryController` + `FeedbackInspectorModule`), registered in `AppModule`.
- `GET /admin/failed-queries?limit&offset` (`@Roles("admin")`) — a read-only, platform-wide feed of answers users rated unhelpful (👎). Runs inside `RlsService.run` under the admin principal so the `is_admin` GUC reads across all tenants (the `RevenueService` cross-tenant template; no `tenant_id` predicate).
- Raw `$queryRawUnsafe` over `answer_feedback` (`helpful = false`, newest first): joins each row to its rated assistant `messages` row (answer text, `model`, `confidence`, `insufficientKnowledge = cardinality(source_version_ids) = 0`) and `LEFT JOIN LATERAL` back to the most-recent `user` message at/before the answer for the original question.
- Shared `failedQueryListQuerySchema` (limit 1..100 default 50, offset ≥0 default 0) + `FailedQueryDto` (`packages/shared/src/failed-queries.ts`), exported from the index.
- Admin UI `apps/admin/app/failed-queries/page.tsx` — a "Flagged answers" card feed (insufficient-knowledge amber badge + model/confidence badges + timestamp; Question / Answer / Reason blocks) with offset "Load more"; new `getFailedQueries` in `admin-client.ts`; "Flagged answers" nav entry in `AdminFrame`.

**Key decisions:**
- Scoped to the persisted `answer_feedback` 👎 signal (concrete, per the manifest's "over answer_feedback" scope) and surfaced the `insufficientKnowledge` flag per-row for richer "failed-retrieval" triage — rather than also scanning every insufficient-knowledge message (a different query, broader scope).
- Raw SQL only for the per-row `LATERAL` question lookup (Prisma Client can't express the correlated "preceding user message" — the M3.3 conversation-search precedent). No aggregates, so no BigInt-coercion gotcha here.
- Verified both relevant RLS policies bypass under `app.is_admin()`: `messages` (tenant_isolation) and `answer_feedback` (tenant_user_isolation) — so the admin context reads cross-tenant without a manual predicate.
- Read-only module (imports only `AuthModule`), mirroring `RevenueModule`.

**Files changed:**
- `apps/api/src/feedback-inspector/failed-query.service.ts` — new; the read choke point + the inspector SQL.
- `apps/api/src/feedback-inspector/failed-query.controller.ts` — new; `@Roles("admin")` route.
- `apps/api/src/feedback-inspector/feedback-inspector.module.ts` — new; wires the above.
- `apps/api/src/feedback-inspector/failed-query.service.test.ts` — new; 4 mocked-tx tests (100% coverage).
- `apps/api/src/app.module.ts` — register `FeedbackInspectorModule`.
- `packages/shared/src/failed-queries.ts` + `failed-queries.test.ts` — new DTO/schema + 5 schema tests.
- `packages/shared/src/index.ts` — export the new schema/types.
- `apps/admin/app/failed-queries/page.tsx` — new flagged-answers page.
- `apps/admin/src/lib/admin-client.ts` — new `getFailedQueries`.
- `apps/admin/src/components/AdminFrame.tsx` — "Flagged answers" nav entry.
- `project-mds/PRD.md` — M8.3 manifest line `[~]` → `[x]`.

**Notes for next iteration:**
- M8.3 is now fully complete (revenue + matrix editor + recommendation-rules editor + failed-query inspector, all API + admin UI). Remaining M8: M8.4 (manage users/subs/experts/voice profiles + audit logs + user-data deletion) and M8.5 (first-class expert portal — voice/knowledge approval, AI-answer review, consultation conversions; also wants the manual TidyCal reconcile + unmatched `booking_webhook_events` admin surface).
- The real `LATERAL` join + the admin cross-tenant visibility join the M11 Testcontainers list (seam-tested with a mocked tx; no live DB this session — the raw-SQL caveat shared with conversation-search / `PgVectorStore`).
- Possible follow-up if the feed grows noisy: a filter toggle for `insufficientKnowledge`-only, or include answers flagged insufficient even without explicit 👎 feedback (would be a second query path over `messages`, not `answer_feedback`).

## M8.4 (partial) — Admin audit infrastructure + user/subscription management + user-data deletion
**Date:** 2026-06-01
**Ref:** PRD M8.4 (§"Admin web portal" → "Manage users, subscriptions, fair-use flags"; §"Foundational security/privacy" → "audit logs for admin & expert actions" + "User data deletion")

**What was done:**
- New `apps/api/src/admin/` module (registered in `AppModule`), the admin-management surface:
  - `AdminAuditService` (`admin-audit.service.ts`) — the cross-cutting **immutable audit-log** backbone. `record(tx, actor, entry)` appends an `admin_audit_logs` row **inside the caller's transaction** (atomic with the action; append-only). `list(user, query)` reads the feed cross-tenant under the admin RLS context, resolving each actor to email/name.
  - `AdminUserService` (`admin-user.service.ts`) — user / subscription / fair-use management + user-data deletion. `list`/`get` (subscription, activity `_count`, fair-use flags, deletion request); `updateRole` (self-lockout-guarded, audits from→to); `flagFairUse`/`updateFairUseFlag`; `requestDeletion`; `executeDeletion` (the GDPR cascade). Every mutation writes an `AdminAuditService` entry in the same tx.
  - `AdminAuditController` (`GET /admin/audit-logs`) + `AdminUserController` (`GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/role`, `POST /admin/users/:id/fair-use-flags`, `PATCH /admin/fair-use-flags/:id`, `POST /admin/users/:id/deletion-request`, `DELETE /admin/users/:id`), both `@Roles("admin")`.
- New shared `packages/shared/src/admin.ts` — audit list query + `AdminAuditLogDto`; `fairUseFlag*`/`FAIR_USE_FLAG_STATUSES`; `dataDeletion*`; `adminUserListQuerySchema`/`adminUserRoleUpdateSchema` + user summary/detail/subscription/activity DTOs. Exported from the index.
- Admin UI: `apps/admin/app/users/page.tsx` (role+search list), `apps/admin/app/users/[id]/page.tsx` (detail with role editor, fair-use raise/resolve, subscription view, two-step destructive delete + deletion-request), `apps/admin/app/audit/page.tsx` (audit feed w/ Load more). New admin-client fns (`listUsers`/`getUser`/`updateUserRole`/`flagFairUse`/`updateFairUseFlag`/`requestUserDeletion`/`deleteUser`/`getAuditLogs`), `fairUseFlagTone`/`roleTone` in `status-tone.ts`, "Users"/"Audit log" nav entries.

**Key decisions:**
- **Audit-in-the-same-transaction** — `record` takes the caller's `tx` so an action and its audit row commit/rollback together; there's no mutation without an audit entry. The audit log (tenant-scoped, actor `SetNull`) is also the **durable proof** a deletion happened, since the `data_deletion_requests` row cascades away with the user.
- **Hard delete via `ON DELETE CASCADE`** — `executeDeletion` writes the audit entry first, then `tx.user.delete`, and Postgres' existing FK cascades remove all owned rows atomically. No manual paginated batch loop (that directive is Firestore-specific). `experts.user_id` is `SetNull`, so an expert's published knowledge/voice outlives a deleted operator account by design.
- **Subscriptions read-only in admin** — the payment provider stays the billing source of truth (directive: only the webhook writes authoritative subscription status), so admin *views* a subscription but changes plan/cancellation through Stripe, not by writing `subscriptions` rows.
- **Self-guards** — an admin can't change their own role or delete their own account (lockout protection), checked before any DB work.
- Reused the `RevenueService`/`EntitlementMatrixService` admin-RLS + path-pinned-identity + mocked-tx-test templates.

**Files changed:**
- `packages/shared/src/admin.ts` (new) + `packages/shared/src/index.ts` (exports) + `packages/shared/src/admin.test.ts` (new, +12)
- `apps/api/src/admin/{admin-audit.service,admin-audit.controller,admin-user.service,admin-user.controller,admin.module}.ts` (new) + `admin-audit.service.test.ts`/`admin-user.service.test.ts` (new, +22) + `apps/api/src/app.module.ts` (register `AdminModule`)
- `apps/admin/src/lib/admin-client.ts` (+8 fns), `apps/admin/src/lib/status-tone.ts` (+`fairUseFlagTone`/`roleTone`), `apps/admin/src/components/AdminFrame.tsx` (+2 nav), `apps/admin/app/users/page.tsx`, `apps/admin/app/users/[id]/page.tsx`, `apps/admin/app/audit/page.tsx` (new)

**Notes for next iteration:**
- **M8.4 is not fully closed** — remaining: expert CRUD (no expert-management API exists; build an `AdminExpertService` on the `AdminUserService` template + an `apps/admin/app/experts` page) and a voice-profile admin UI over the existing M2.3 `/voice-profiles` routes (just admin-client fns + a page). Thread `AdminAuditService.record` through any new expert mutation. Marked `[~]` in the manifest.
- Seam-tested with a mocked tx; the real cascade + admin cross-tenant visibility + the `fair_use_flags`/`data_deletion_requests` WITH-CHECK-under-`is_admin` inserts join the M11 Testcontainers list.
- Full `apps/api` suite ran clean this session: 58 suites / 494 tests. Totals: 775 pass (shared 126, ui 3, db 9, ai 143, api 494).

## M8.4 (COMPLETE) — Admin expert-roster management + voice-profile admin UI
**Date:** 2026-06-01
**Ref:** PRD M8.4 (§"Admin & Expert portals" → "Manage … experts / voice profiles"); closes the two items left `[~]` after the prior M8.4 slice (audit + users/subscriptions/fair-use + user-data deletion).

**What was done:**
- **Expert CRUD API.** New `AdminExpertService` (`apps/api/src/admin/admin-expert.service.ts`) + `AdminExpertController` (`/admin/experts`, `@Roles("admin")`), registered in `AdminModule`. Methods: `list` (active + slug/name search, voice-profile `_count`), `get` (operator email + voice/document `_count`, 404), `create` (optional operator link, P2002→409, 404 missing operator), `update` (free-text + operator connect/disconnect/unlink, slug frozen, "" → null), `setActive` (toggle). Every mutation appends an `AdminAuditService` entry in the same tx (`expert.created`/`updated`/`activated`/`deactivated`).
- **Shared DTOs/schemas** in `packages/shared/src/admin.ts`: `adminExpertListQuerySchema` (boolean-or-query-string `active`), `adminExpertCreateSchema` (url-safe slug regex, normalized name/title/bio), `adminExpertUpdateSchema` (nullable userId, empty-patch rejected), `adminExpertActiveUpdateSchema`, `AdminExpertSummaryDto`/`AdminExpertDetailDto` (+ index exports).
- **Expert admin UI:** `apps/admin/app/experts/page.tsx` (filtered table + inline create form) + `apps/admin/app/experts/[id]/page.tsx` (active toggle, details editor incl. operator link, voice/document Stat cards, deep link to `/voice-profiles?expertId=`).
- **Voice-profile admin UI** over the existing M2.3 `/voice-profiles` routes (no new API): `apps/admin/app/voice-profiles/page.tsx` — status/expert-filtered sign-off queue (reuses `publishStatusTone`/`statusLabel`), per-row Submit/Approve/Request-changes, inline draft editor, create form. New admin-client fns + a local `VoiceProfileAdminDto` (wire shape). "Experts"/"Voice profiles" nav entries added to `AdminFrame`.

**Key decisions:**
- Audit threaded only through the NEW expert mutations; voice-profile actions reuse the M2.3 `VoiceProfileService` unchanged (no audit retrofit — per the seam note, those routes are the API-done piece).
- Slug frozen after create (identity field, directive §4.7) — only `create` accepts it.
- Operator link via Prisma `{ connect }`/`{ disconnect }` so a null `userId` unlinks; both unique constraints (slug, operator) map to a single 409.
- Voice-profile DTO kept admin-local rather than retrofitting the api-local `VoiceProfileSummary` (carries `Date`/`@expertos/ai` types) into shared.
- Read the `?expertId=` deep link via `window.location` in an effect (no `useSearchParams`) to avoid the Next static-render Suspense-boundary build requirement (no precedent for it in the repo).

**Files changed:**
- `apps/api/src/admin/admin-expert.service.ts`, `admin-expert.controller.ts`, `admin-expert.service.test.ts` — new (service 100% all metrics, 20 tests).
- `apps/api/src/admin/admin.module.ts` — register the new service + controller.
- `packages/shared/src/admin.ts` (+ `admin.test.ts` +12, `index.ts` exports) — expert schemas/DTOs.
- `apps/admin/app/experts/page.tsx`, `app/experts/[id]/page.tsx`, `app/voice-profiles/page.tsx` — new pages.
- `apps/admin/src/lib/admin-client.ts` — expert + voice-profile client fns + `VoiceProfileAdminDto`.
- `apps/admin/src/components/AdminFrame.tsx` — "Experts"/"Voice profiles" nav.

**Notes for next iteration:**
- **M8.5 (expert portal) is the last open M8 item.** Build it on this session's precedent: same `AdminFrame` + `admin-client` shape; reuse `listVoiceProfiles`/`voiceProfileAction` (the M2.3 routes scope an expert to their own profiles service-side) + the M8.1 `/knowledge` routes; add consultation-conversion views over the M7 funnel + an admin surface for the manual TidyCal reconcile / unmatched `booking_webhook_events`.
- Seam-tested with a mocked tx; the real expert writes + the cross-tenant admin RLS visibility join the M11 Testcontainers list.
- Full `apps/api` suite ran clean this session: 59 suites / 514 tests. Totals: 807 pass (shared 138, ui 3, db 9, ai 143, api 514).

## M8.5 — Expert portal (first-class `expert` role)
**Date:** 2026-06-01
**Ref:** PRD §"Admin & Expert portals" → "Expert portal (first-class `expert` role)"; Task Manifest M8.5

**What was done:**
- Closed M8 (M8.5 was the last open item). Two of the four deliverables — approve **voice** + approve **knowledge** — already worked through the existing expert-scoped `/voice-profiles` (M2.3, `assertOwnership`) and `/knowledge` (M8.1, `@Roles("expert")`) routes whose admin pages were built earlier. M8.5 added the two genuinely missing read surfaces and made the portal role-aware.
- **API:** new `apps/api/src/expert/` module — `ExpertPortalService` behind `@Roles("expert")` `GET /expert/conversions` + `GET /expert/answers`; `ExpertModule` registered in `AppModule`.
  - `conversions(user, requestedExpertId)` → `ExpertConversionsDto`: recommendations by trigger + by response, consultations by status, booked-and-beyond revenue, and a recent feed. Prisma `groupBy` (Int `_sum.amountCents` is a plain `number`, no BigInt coercion).
  - `answers(user, requestedExpertId, query)` → `ExpertAnswerReviewDto[]`: raw-SQL `LATERAL` feed mirroring the M8.3 failed-query inspector (assistant message + prompting question + latest feedback verdict + empty-`source_version_ids` insufficient-knowledge proxy), newest first, paginated.
- **Role-aware admin portal:** `auth-context` fetches `GET /me` after sign-in to expose the API `role`; `AdminFrame` splits nav into an **Expert** group (Knowledge, Drafts, Voice profiles, AI answers, Conversions) shown to expert+admin, and an **Admin** group (Revenue, Entitlements, Funnel rules, Flagged answers, Users, Experts, Audit log) shown only once `/me` resolves to admin.
- **Pages:** `apps/admin/app/conversions/page.tsx` (Stat cards + by-trigger/response/status breakdowns + recent feed; admin gets a `listExperts` picker) and `apps/admin/app/answers/page.tsx` (answer-review card feed w/ feedback badges + "Load more").
- **Shared:** new `packages/shared/src/expert.ts` — `expertAnswerListQuerySchema`, `ExpertConversionsDto`/`ExpertConversionItemDto`/`ExpertAnswerReviewDto`, `ConsultationStatusValue`, `RecommendationFunnelResponse`.
- New admin-client fns: `getMe`, `getExpertConversions`, `getExpertAnswers`; new `consultationStatusTone`/`funnelResponseTone` in `status-tone.ts`.

**Key decisions:**
- **Elevated-but-bounded read** is the architectural crux. The funnel rows belong to end users and are `user_scoped` under RLS, so a non-admin expert can't see them under their own context. The service runs reads in an elevated context (`runReviewer` = `applyRlsContext({tenantId: user.tenantId, isAdmin: true})`, the `BookingService.runAsSystem` precedent) and re-establishes isolation with **explicit** `tenant_id` + `conversation.expert_id` predicates in every query. Safe-by-construction: resolve the expert first and short-circuit to empty when none resolves, so every data query always carries a concrete `expert_id` and can never widen to the tenant.
- A dedicated expert module with explicit predicates over relaxing the admin-only failed-query inspector to `@Roles("expert")` — that inspector has no voice scope, so an expert would see every tenant's flagged answers. The voice-scoping *is* the point of the expert portal.
- Admin reviews a chosen expert via the roster picker; no platform-wide expert-portal view (that's M10 analytics).
- `runReviewer` injects `PRISMA` directly rather than using `RlsService.run`, because `RlsService.run` derives `is_admin` from `user.role` — an expert there would be tenant+user-scoped and couldn't see customers.

**Files changed:**
- `packages/shared/src/expert.ts` (new) + `packages/shared/src/index.ts` (exports) — wire DTOs + schema.
- `apps/api/src/expert/expert-portal.service.ts` (new) — the read choke point + elevated/bounded RLS.
- `apps/api/src/expert/expert-portal.controller.ts` (new) — `@Roles("expert")` routes; optional `?expertId=` via `ParseUUIDPipe({optional:true})`.
- `apps/api/src/expert/expert.module.ts` (new) + `apps/api/src/app.module.ts` (register).
- `apps/admin/src/lib/auth-context.tsx` — `role` state fetched from `/me`.
- `apps/admin/src/components/AdminFrame.tsx` — role-aware Expert/Admin nav groups.
- `apps/admin/src/lib/admin-client.ts` — `getMe` (local `MeDto`), `getExpertConversions`, `getExpertAnswers`.
- `apps/admin/src/lib/status-tone.ts` — `consultationStatusTone`, `funnelResponseTone`.
- `apps/admin/app/conversions/page.tsx` (new), `apps/admin/app/answers/page.tsx` (new).
- Tests: `apps/api/src/expert/expert-portal.service.test.ts` (+12), `packages/shared/src/expert.test.ts` (+5).

**Notes for next iteration:**
- **M8 is fully complete.** Next gated milestone is **M9 (Concierge Mode)** behind **OD#5** (Mode B legal/brand ruling) — resolve it or fall back to Mode-A-only. The M8.5 expert portal is the host for the **M9.2 concierge review queue**: build it on the `ExpertPortalService` elevated-but-bounded pattern (flagged low-confidence answers scoped to the expert's voice) and add it to the role-aware Expert nav group.
- **Deferred admin surface:** the manual TidyCal reconcile (`POST /consultation-bookings/reconcile`, admin-only) + unmatched `booking_webhook_events` (`matched=false`) still have no UI — a small admin page closes the OD#10 loop.
- Seam-tested with a mocked tx; the real elevated cross-user read + the `LATERAL` join join the M11 Testcontainers list (raw-SQL caveat shared with the failed-query inspector / `PgVectorStore`).
- Full `apps/api` suite ran clean this session: **60 suites / 526 tests**. Totals: **824 pass** (shared 143, ui 3, db 9, ai 143, api 526).

## Admin TidyCal reconciliation surface (M7.3 / OD#10 follow-up)
**Date:** 2026-06-01
**Ref:** PRD §"Consultation funnel" / §"Open Decisions" #10; deferred admin surface flagged in the M7.3 + M8.5 seam notes

**What was done:**
- Closed the missed-event-recovery loop end-to-end. M7.3 shipped `POST /consultation-bookings/reconcile` + the `booking_webhook_events` ledger that keeps an uncorrelated booking as `matched=false` (no-vanish), but there was no read path or UI for those unmatched rows.
- **API read path:** `BookingService.listUnmatched({limit,offset})` — returns `matched=false` ledger rows newest-first via Prisma Client `findMany`, mapped to a new shared `UnmatchedBookingEventDto` (dates → ISO). Runs in the same `runAsSystem` context (admin GUC / GLOBAL tenant) the webhook/reconcile paths use; `booking_webhook_events` is RLS-exempt and an unmatched booking can belong to any tenant.
- New `GET /consultation-bookings/unmatched` route (`@Roles("admin")`) on the existing `ConsultationBookingsController` + `unmatchedBookingListQuerySchema` (limit 1..100 default 50, offset ≥0) in `packages/shared/src/consultation.ts`.
- **Admin UI:** new `apps/admin/app/reconcile/page.tsx` (a "Bookings" nav entry in the Admin group) — a "Run reconcile" card (optional `since` datetime-local + a Stat summary of polled/applied/matched/skipped) and the unmatched-event feed (amber "Unmatched" badge + event-type/provider badges + booking ref / contact email / scheduled time) with offset "Load more". New `reconcileBookings`/`getUnmatchedBookings` admin-client fns.

**Key decisions:**
- Reused `BookingService` + the private `runAsSystem` rather than introducing a new admin service — the reconcile path already lives there and the ledger is RLS-exempt, so it's the natural choke point (kept the booking-sync logic in one place).
- Prisma Client `findMany` over raw SQL — no aggregate/`LATERAL` is needed here, so the M8.3 BigInt-coercion gotcha doesn't apply.
- Reconcile refreshes the unmatched feed on success so any newly-recovered booking drops off the list immediately.
- The page uses only design-system classes/primitives (no inline styles, matching the other admin pages; no hardcoded px/hex so the lint guard stays green).

**Files changed:**
- `packages/shared/src/consultation.ts` — `unmatchedBookingListQuerySchema` + `UnmatchedBookingListQueryInput` + `UnmatchedBookingEventDto`.
- `packages/shared/src/index.ts` — re-export the new schema/types (the index uses explicit named re-exports, not `export *`).
- `apps/api/src/consultation/booking.service.ts` — `listUnmatched` method + the `UnmatchedBookingRow`→DTO mapper.
- `apps/api/src/consultation/consultation-bookings.controller.ts` — `GET /consultation-bookings/unmatched` (`@Roles("admin")`).
- `apps/admin/src/lib/admin-client.ts` — `reconcileBookings` + `getUnmatchedBookings`.
- `apps/admin/src/components/AdminFrame.tsx` — "Bookings" nav entry (Admin group).
- `apps/admin/app/reconcile/page.tsx` — new page.
- `apps/api/src/consultation/booking.service.test.ts` — +2 `listUnmatched` tests (mock tx gains `findMany`).
- `packages/shared/src/consultation.test.ts` — +4 `unmatchedBookingListQuerySchema` tests.

**Notes for next iteration:**
- Seam-tested with a mocked tx; the real `booking_webhook_events` read joins the M11 Testcontainers list.
- The unmatched feed is read-only — there's no per-row "manually link to a consultation" action. A reconcile poll is the only recovery mechanism; a manual link/dismiss action on a specific unmatched row could be a future follow-up if operators need it (would need a new write method on `BookingService`).
- All gates green (typecheck/lint/knip/build all 7 workspaces); `booking.service.ts` stays 100% all metrics. Totals: **830 pass** (shared 147, ui 3, db 9, ai 143, api 528).

## Consumer-web Plan & Usage page (deferred web-UI; M6.3 transparent usage indicator)
**Date:** 2026-06-01
**Ref:** PRD §"Paywall, Entitlements & Feature Gating" / M6.3 — deferred consumer-web UI (the API `GET /me/entitlements` + the `UsageMeter` primitive shipped in M6 with no web page consuming them).

**What was done:**
- New `apps/web/src/lib/account-client.ts` — thin `fetchEntitlements(token)` wrapper over `GET /me/entitlements` (mirrors `chat-client.ts`'s `NEXT_PUBLIC_API_URL` default + Bearer-token pattern; surfaces a `(status)` error on non-OK).
- New `apps/web/app/account/page.tsx` ("Plan & usage") — gates on sign-in, loads the acting user's plan + per-feature entitlements, and renders:
  - **metered** features via the `UsageMeter` DS primitive (`used` vs hard `limit`, plus the M6.3 fair-use `softLimit` warn band → amber, "Unlimited"/"fair-use N" labels handled by the primitive); a *disabled* metered feature shows a "Not included" badge instead of a misleading 0/0 meter.
  - **boolean** features as Included (green) / Not-included (ink) badges.
  - the current plan name as a green badge; loading/error as info/red badges.

**Key decisions:**
- Reused the existing `UsageMeter`/`Badge`/`Card` primitives verbatim (no new UI) so meter threshold/warn/Unlimited semantics stay single-sourced in `packages/ui`.
- Split metered vs boolean rendering — boolean features have no quota to meter.
- Purely additive frontend: no API/shared/backend code touched, so test counts are unchanged (830). The repo has no Next page tests (web precedent), so the gates are typecheck/lint/build/knip.
- Did NOT add cross-page navigation (home/chat have none either — matched existing pattern); the page is reachable at `/account`.

**Files changed:**
- `apps/web/src/lib/account-client.ts` — new: `fetchEntitlements`.
- `apps/web/app/account/page.tsx` — new: the Plan & usage page.

**Notes for next iteration:**
- Remaining deferred consumer-web UI: conversation history sidebar + saved answers + full-text search + answer feedback (M3.2–M3.4 are API-only); web upload UI with the temp/persistent mode picker POSTing to `/uploads` (M5); and surfacing the chat `done.degraded` flag as a subtle fair-use note in `apps/web/app/chat/page.tsx` (pairs naturally with this page's fair-use story).
- Build gotcha reconfirmed: `next build` with `output: standalone` over a stale `.next` cache throws `SyntaxError: Unexpected end of JSON input` — `rm -rf apps/*/.next apps/*/.turbo` then rebuild (already documented in the seam notes).
- No nav scaffold exists in `apps/web`; if more pages land, consider a small shared top-nav (out of scope here).

## Consumer-web chat answer affordances (feedback + insufficient-knowledge + degraded note)
**Date:** 2026-06-01
**Ref:** PRD Task Manifest Phase 1 — M3.4 (answer feedback + insufficient-knowledge path) & M6.3 (fair-use degrade-don't-block); deferred consumer-web UI from progress-state "Next tasks".

**What was done:**
- Surfaced three already-shipped `done`-frame signals on the existing `apps/web/app/chat/page.tsx` — all had API/wire support (M3.4/M6.3) but no consumer UI.
- **Answer feedback (M3.4):** added `submitFeedback(messageId, helpful, token, reason?)` to `apps/web/src/lib/chat-client.ts` (POSTs the idempotent `/answer-feedback` upsert, omits an empty reason). New `AnswerFeedback` component under each finished assistant answer: 👍/👎 buttons (active state via `aria-pressed`, flip the verdict), and once a verdict is chosen an optional reason `Input` (maxLength 500, mirrors the API bound) + a "Send reason" button that re-submits the same verdict with the reason.
- **Insufficient-knowledge next step (M3.4):** when `done.insufficientKnowledge` is true, an amber "Limited knowledge" `Card` suggests rephrasing or booking a consultation.
- **Fair-use degraded note (M6.3):** when `done.degraded` is true, a subtle info `Badge` notes the answer was served by the lighter model over the period's soft limit.
- `UiMessage` now captures `messageId` / `insufficientKnowledge` / `degraded` off the `done` event (previously only `citations`/`recommendation` were captured).

**Key decisions:**
- Reused existing DS primitives (`Button`/`Badge`/`Input`/`Card`) + `.row/.gap2/.wrap/.muted/.label` utilities — no new CSS or components (directive §2.3: search before building UI).
- Feedback verdict submits immediately on 👍/👎 click (reason optional, addable after) because the endpoint is an idempotent upsert keyed on `(user, message)` — re-submitting flips the verdict or revises the reason, so there's no "save" gate to design.
- Purely additive frontend; no API/shared/backend code touched, so the 830 test count is unchanged and no tested package was affected.

**Files changed:**
- `apps/web/src/lib/chat-client.ts` — added `submitFeedback` + `AnswerFeedbackDto` import.
- `apps/web/app/chat/page.tsx` — extended `UiMessage` + `done`-event capture; added `AnswerFeedback` component; rendered the degraded note, insufficient-knowledge card, and feedback control in the assistant card; imported `Input` from `@expertos/ui` and `submitFeedback`.

**Notes for next iteration:**
- Remaining deferred consumer-web UI: **conversation history sidebar + saved-answers list + full-text search** (M3.2/M3.3 are API-only — consume `GET /conversations`, `/conversations/:id`, `/saved-answers`, `/conversations/search`); and the **web upload UI** with the temp/persistent mode picker POSTing to `/uploads` (M5). The chat page now also has the `messageId` in hand if a "save answer" bookmark affordance (`POST /saved-answers`) is wanted alongside feedback.
- No nav scaffold in `apps/web` yet; if a history sidebar lands it pairs with a small shared layout (out of scope here).

## Consumer-web chat history + conversation search + saved-answers UI (deferred web-UI; M3.2 + M3.3)
**Date:** 2026-06-01
**Ref:** PRD §"Chat experience" / "History & retention" — M3.2 (conversation history + auto-titling + saved answers) and M3.3 (full-text conversation search). Both shipped API-only; the deferred consumer-web UI was tracked in progress-state "Next tasks" item 3.

**What was done:**
- New `apps/web/src/lib/history-client.ts` — typed fetch wrappers (Bearer + `NEXT_PUBLIC_API_URL`, mirroring `chat-client.ts`/`account-client.ts`): `listConversations`, `getConversation`, `searchConversations`, `renameConversation`, `listSavedAnswers`, `createSavedAnswer`, `removeSavedAnswer`. A 409 on bookmark maps to a benign `duplicate` rather than throwing (the API's idempotent-create contract).
- New `apps/web/src/components/answer-view.tsx` — extracted the chat page's local `renderAnswer` (the `[n]`-marker→`.cite` renderer) + the M4.2 sources drawer (click-to-passage, `.source.active` highlight) into one shared `AnswerView` component taking `interactive` (render-after-resolve gate). Used by both the live chat turn and the history transcript so they can't drift.
- New `apps/web/app/history/page.tsx` — single-column master/detail: search box (Enter-to-search; guillemet `«»` snippets rendered as text per directive §1), paginated "Recent conversations" list ("Load more"), conversation detail (full transcript via `AnswerView` + inline-edit rename + per-answer bookmark), and a "Saved answers" panel (list + remove + jump-into-conversation via `getConversation`).
- `apps/web/app/chat/page.tsx` — refactored `AssistantAnswer` to delegate to the shared `AnswerView` (removed the duplicated `MARKER`/`renderAnswer` + drawer; kept the streaming-`…`-placeholder wrapper); added a `SaveAnswer` bookmark button under each finished answer (gives saved-answers a web producer; 409 → "Saved ★").
- `apps/web/app/page.tsx` — added a signed-in nav (Chat / History / Plan & usage) so the standalone pages are discoverable.

**Key decisions:**
- Extracted `AnswerView` into a shared component rather than re-implementing the ~50-line marker renderer in the history page (directive §2.3 reuse / match patterns). Behavior preserved exactly: chat passes `interactive={message.done}` (markers non-interactive mid-stream), history passes `interactive` (a persisted answer is final). The chat page keeps its own streaming placeholder since that's chat-specific.
- Single-column master/detail (view-state toggle) over a chat-embedded sidebar — matches the existing standalone-page web layout (`/account`, `/chat`) and avoids re-architecting the chat page. A future enhancement could let the user continue a past conversation (chat page would need to read a `conversationId`); left out of scope.
- Reused DS primitives (`Button`/`Badge`/`Card`/`Field`/`Input`) + existing `.row/.gap/.col/.muted/.label/.source-quote` utilities — no new CSS, no new components beyond `AnswerView` (§2.2 no hardcoded colors trivially satisfied).
- Purely additive frontend: no API/shared/backend code touched, so the 830-test suite is unaffected (no tested package changed).

**Files changed:**
- `apps/web/src/lib/history-client.ts` — NEW: conversation/saved-answer fetch wrappers.
- `apps/web/src/components/answer-view.tsx` — NEW: shared answer + sources-drawer renderer.
- `apps/web/app/history/page.tsx` — NEW: history list/search/detail + saved-answers UI.
- `apps/web/app/chat/page.tsx` — refactored to use `AnswerView`; added `SaveAnswer` bookmark control.
- `apps/web/app/page.tsx` — added signed-in nav links.

**Notes for next iteration:**
- The last remaining deferred consumer-web UI is the **web upload UI** (M5 — a file picker + temp/persistent mode toggle POSTing multipart to `/uploads`; the API is done end-to-end, no web consumer). When built, fold a new `uploads-client.ts` + a chat-attached file picker; uploads then surface as info-blue `.cite.upload` citations (`AnswerView` already renders the `upload` kind / `sourceLabel`).
- `AnswerView` is now the single answer-rendering component — any future change to citation rendering (e.g. an M8 knowledge-passage deep link off `documentVersionId`+`chunkId`) belongs there, not in either page.
- History is master/detail, not a chat-embedded sidebar; if "continue this conversation" is wanted, the chat page needs to accept an incoming `conversationId` (URL param or shared state) and pre-load its transcript before streaming the next turn.
- Still no page tests in `apps/web` (repo-wide convention; gates are typecheck/lint/build/knip).

## Consumer-web document upload UI (deferred web-UI; M5)
**Date:** 2026-06-01
**Ref:** PRD §"Document-assisted Q&A" (M5.1/M5.2) — the `POST /uploads` API shipped in M5 with no web consumer; the last open deferred consumer surface (flagged in the prior log entry's "Notes for next iteration").

**What was done:**
- New `apps/web/src/lib/upload-client.ts` — `uploadFile(token, file, mode, conversationId?)` POSTs multipart form-data to `/uploads` (the file part + `mode`/`conversationId` text fields that the API's `uploadCreateSchema` validates). Leaves `Content-Type` unset so the browser writes the multipart boundary. Surfaces the API's `{message}` error body verbatim for rejections (415 unsupported type, 413 too large, 422 malware scan, 400 spoof) via a small `errorMessage(res)` helper, falling back to the status code. Exports `UPLOAD_ACCEPT` (extensions + MIME hint for the native picker, mirroring server `UPLOAD_TYPES`).
- New `UploadPanel` component on `apps/web/app/chat/page.tsx` — mode `Select` (Temporary / Persistent), a native `<input type="file" accept={UPLOAD_ACCEPT}>` that uploads on change (reset via a bumped `key` after each upload), and a list of uploaded files showing filename + mode badge + `formatBytes` size + a green "{n} searchable chunks" / amber "stored — not searchable yet" badge (the `chunkCount === 0` PDF/DOCX-parser-pending case). Wired into the render between the error badge and the question field; receives the chat's current `conversationId`. Shows a "send a message first" hint when mode is temporary and no conversation exists yet (temporary uploads are only retrievable for the current conversation).

**Key decisions:**
- Placed the upload UI on the chat page rather than a standalone page — uploads are query-time and conversation-attached (temporary uploads fold into retrieval only for the current `conversationId`; persistent uploads index into the user's private knowledge regardless).
- Reused `Card`/`Badge`/`Field`/`Select` DS primitives + `.col/.row/.gap2/.wrap/.muted` utilities + a native `<input type="file">` (the `@expertos/ui` package exports no file-input primitive) — no new CSS/components.
- Surfaced `chunkCount` so the user can distinguish a stored-but-unsearchable format (parser not landed: PDF/DOCX) from an indexed one — the server is still the authority on type/size/safety, so the picker's `accept` only narrows the native dialog.
- Multipart text fields (`mode`, `conversationId`) ride alongside the file in `FormData`; NestJS's `FileInterceptor` (multer) populates `req.body` with them, so the existing `@Body(ZodValidationPipe(uploadCreateSchema))` validates them unchanged — no API change needed.
- Purely additive frontend; no API/shared/backend code touched.

**Files changed:**
- `apps/web/src/lib/upload-client.ts` — NEW: `uploadFile` multipart client + `UPLOAD_ACCEPT` + `errorMessage` helper.
- `apps/web/app/chat/page.tsx` — added `UploadPanel` + `formatBytes`; imported `uploadFile`/`UPLOAD_ACCEPT` and the `UploadedFileDto`/`UploadMode` types; rendered the panel above the question field.

**Notes for next iteration:**
- The deferred consumer-web UI backlog is now **empty** (account/usage, chat feedback + insufficient/degraded notes, history/search/saved-answers, and now uploads all shipped).
- An uploaded file's chunks fold into retrieval automatically (M5.4 — `RetrievalService.retrieveUploads`); a temporary upload made *before* the first message won't attach to a conversation (no `conversationId` yet) — the UI hints to send a message first. If a "draft conversation id minted client-side before the first turn" concept is ever added, the upload could attach earlier.
- No "remove/list my uploads" management surface yet — `UploadPanel` only lists files uploaded in the current session (no `GET /uploads` list endpoint exists). If users need to see/delete past uploads, that needs a new API read/delete path first (then a panel or an account-page section).
- Still no page tests in `apps/web` (repo-wide convention; gates are typecheck/lint/build/knip).

## M11.2 (partial) — Prompt-injection hardening + regression fixtures
**Date:** 2026-06-01
**Ref:** PRD §"Security & Compliance" → "LLM trust boundary"; §"Testing Strategy" → "prompt-injection regression fixtures"; Task Manifest M11.2

**What was done:**
- Hardened the answer-prompt builder (`packages/ai/src/prompt/answer-prompt.ts`) against prompt injection — it interpolated untrusted SOURCES (retrieved knowledge + user-uploaded documents) and the untrusted QUESTION (raw end-user input) with no delimiting.
- Added an explicit `UNTRUSTED INPUT` rule (rule 2, after facts-authoritative) to the system prompt: the SOURCES/QUESTION are data to analyse, never instructions; ignore in-band "ignore previous instructions" / role-change / fake-block ploys; the only instructions obeyed are in the system message.
- Added pure `neutralizeInjection(text)` that swaps `[\d+]` → `(\d+)` inside each untrusted source's content and the user question, **before** the builder mints the real `[index+1]` slot prefix — defangs forged citation markers (can't fabricate provenance the model / M4 citation builder would resolve against the real list) and can't inflate the real source count.
- New `packages/ai/src/prompt/prompt-injection.test.ts` — 6 regression fixtures (structural, deterministic): untrusted rule present; malicious override stays inside the SOURCES data block; forged marker in source defanged; forged marker via question defanged; bracket spam mints no extra real slots; legit bracketed prose preserved.

**Key decisions:**
- Kept the literal `SOURCES:`/`QUESTION:` headers because the `EchoLlmProvider` parser keys off `QUESTION:` and counts `[n]` markers in the SOURCES region — changing them requires a lockstep parser change (the documented seam constraint). The untrusted-data framing lives in the system rule instead.
- Neutralization applied only to the clearly-untrusted boundary (upload/knowledge facts + query), not expert-authored voice guidelines/examples (those pass through the M2.3 sign-off workflow).
- Structural assertions only (the builder is pure / offline) — matches the PRD's deterministic regression-fixture approach; live-model red-teaming is out-of-band.

**Files changed:**
- `packages/ai/src/prompt/answer-prompt.ts` — header doc-comment (M11.2 hardening note); `neutralizeInjection` helper; UNTRUSTED INPUT rule (renumbered rules 2→6); apply neutralization to source content + query in `buildUserPrompt`.
- `packages/ai/src/prompt/prompt-injection.test.ts` — new regression suite (6 fixtures).
- `project-mds/progress-state.md`, `project-mds/PRD.md` (Task Manifest M11.2 note) — progress.

**Notes for next iteration:**
- **Remaining M11.2:** authz/RLS negative tests (user can't read another user's uploads/conversations; non-admin can't hit admin routes) — these need the deferred M11 Testcontainers live-DB pass for real RLS enforcement; rate-limit tests (note: no per-request rate limiter is built yet — only M6.1 entitlement metering / fair-use quotas; true rate limiting is a Redis/Memorystore add per the PRD architecture); `/cso` audit.
- **Latent fix:** the echo provider previously miscounted a `[7]` buried in source text as an extra numbered source; now neutralized.
- **When the real OpenAI/Anthropic LLM driver lands:** keep both defences in any new prompt path — the system-prompt instruction hierarchy AND marker neutralization on untrusted interpolated text. Consider adding output-schema validation (the third leg the PRD names) once a structured-output model is wired.

## M11.2 (partial) — Per-IP HTTP rate limiter + tests
**Date:** 2026-06-01
**Ref:** PRD M11.2 (Security tests → rate-limit); §"Security & Compliance" ("Abuse/fair-use: per-user rate limiting, automated throttling"); §"Testing Strategy" (rate-limit tests); architecture §"No full infra Day 1" (in-process LRU now, Memorystore Redis later)

**What was done:**
- Added the first request-rate limiting to the API. Until now the only volume control was the per-user *metered quota* (M6.1 entitlements), which bounds a signed-in user's answer consumption but leaves raw request volume — including unauthenticated traffic to the `@Public()` billing/TidyCal webhook + auth routes — unbounded. A burst could therefore exhaust token-verification / HMAC work (a DoS / brute-force vector). The new limiter is the orthogonal coarse per-IP layer.
- New `apps/api/src/rate-limit/` module:
  - `rate-limit.service.ts` — `RateLimitService`, the coverage-gated choke point: a deterministic, clock-injectable **fixed-window** counter keyed by client IP, backed by the existing `LruCache` (bounded to `maxTrackedKeys` so an IP-spray evicts cold buckets rather than growing memory unbounded). `hit(key)` returns `{allowed, limit, remaining, resetAt, retryAfterMs}`; the window start is preserved across hits (stable `resetAt`), a fully-elapsed window reopens fresh.
  - `rate-limit.guard.ts` — `RateLimitGuard` (thin), registered as the **first** global `APP_GUARD`. Extracts the IP from the leftmost `X-Forwarded-For` hop (→ `req.ip` → socket → shared `"unknown"`), sets `X-RateLimit-Limit/Remaining/Reset` on every response, and on a block sets `Retry-After` + throws `429` with a `{reason:"rate_limited", retryAfterSeconds}` body. `clientIp` is exported + unit-tested directly.
  - `skip-rate-limit.decorator.ts` — `@SkipRateLimit()`, applied to the `@Public()` health check so Cloud Run's tight-interval polling doesn't consume a client IP budget.
  - `rate-limit.config.ts` — env-tunable `RateLimitOptions` (`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`/`RATE_LIMIT_MAX_KEYS`; defaults 300 req / 60 s / 50k IPs). A non-positive/unparseable override falls back to the default so a typo can never disable the limiter or set a zero window.
  - `rate-limit.module.ts` — wires the `RATE_LIMIT_OPTIONS` factory + service + the `APP_GUARD`. Imported **first** in `AppModule.imports`.
- `health.controller.ts` gains `@SkipRateLimit()`. `app.module.ts` imports `RateLimitModule` first (comment explains the ordering intent).
- Tests: `rate-limit.service.test.ts` (×6) + `rate-limit.guard.test.ts` (×7) = +13 `apps/api`.

**Key decisions:**
- **Hand-rolled over `@nestjs/throttler`** — matches the repo's dependency-light, swappable-abstraction philosophy (the `LruCache`/`PaymentProvider`/`StorageProvider` precedent) and the "in-process now, Redis later" architecture. The `LruCache` is the documented Memorystore Redis swap point; nothing else in the limiter changes when that lands.
- **Keyed by IP, not user** — it must protect *unauthenticated* routes and run before auth (so no `authUser` exists yet). The per-user quota already covers signed-in answer consumption; this is the complementary coarse layer.
- **Registered as the first global guard** so a burst is throttled before the auth guards spend token-verification work on it. Functional correctness (IP keying) does not depend on the order, but the DoS-protection benefit does. Relies on the same APP_GUARD module-import ordering the repo already depends on (EntitlementsModule-after-AuthModule).
- **The guard does not log the IP** — `AllExceptionsFilter` already logs the 4xx rejection at WARN, and an IP is arguably PII (directive: keep PII out of log fields). So the guard injects no logger.
- **XFF trust caveat documented** — the leftmost `X-Forwarded-For` hop is the real client behind Cloud Run / a trusted LB, but a hostile client on an untrusted edge can spoof it. Documented in the guard as defense-in-depth beneath a platform edge limiter (Cloud Armor), not the sole control.

**Files changed:**
- `apps/api/src/rate-limit/rate-limit.config.ts` — new: env-tunable options + `RATE_LIMIT_OPTIONS` token.
- `apps/api/src/rate-limit/rate-limit.service.ts` — new: the fixed-window counter over `LruCache` (coverage-gated, 100%).
- `apps/api/src/rate-limit/rate-limit.guard.ts` — new: thin global guard + exported `clientIp`.
- `apps/api/src/rate-limit/skip-rate-limit.decorator.ts` — new: `@SkipRateLimit()`.
- `apps/api/src/rate-limit/rate-limit.module.ts` — new: wires the token/service/guard.
- `apps/api/src/rate-limit/rate-limit.service.test.ts` / `rate-limit.guard.test.ts` — new: +13 tests.
- `apps/api/src/app.module.ts` — import `RateLimitModule` first.
- `apps/api/src/health/health.controller.ts` — add `@SkipRateLimit()` to the health check.

**Notes for next iteration:**
- **Extend this for real per-user/abuse throttling** — `RateLimitService.hit(key)` is key-agnostic; a future tier could key authenticated routes by `user.id` (run a second guard *after* auth) for fairer limits when many users share a NAT IP. The PRD §"Abuse/fair-use" also lists bot/automation + account-sharing detection — separate, larger work.
- **Cross-instance limiting needs Redis** — the in-process counter is per-instance, so on Cloud Run with N instances the effective ceiling is ~N×max. Acceptable as a coarse safety net at launch; swap the `LruCache` in `RateLimitService` for a Memorystore-backed store when volume justifies it (the PRD architecture's stated trigger).
- **DI-bootstrap smoke could not run** on this box — the documented Prisma-engine SIGILL quirk (the generated client rejects `binary`; the library engine SIGILLs) blocks `NestFactory.create`. The wiring mirrors the existing `EntitlementGuard` APP_GUARD pattern exactly, so DI risk is minimal; a clean parallel run / live DB validates it (joins the M11 list).
- **Remaining M11.2:** authz/RLS negative tests (needs the M11 Testcontainers live-DB pass for real RLS enforcement), `/cso` audit.

## M11.2 (partial) — Live-DB authz/RLS negative tests
**Date:** 2026-06-01
**Ref:** PRD M11.2 (Security tests — authz/RLS negative); §"Data Model" RLS isolation guarantee; §"Testing Strategy"

**What was done:**
- Added `packages/db/src/rls.integration.test.ts` — 15 live-database tests that validate the RLS policies from migration `20260531212901_rls_and_vector_index` against a **real Postgres**, connecting as the non-superuser **`app_user`** role (the role that actually enforces RLS — the table owner/superuser bypasses it; FORCE ROW LEVEL SECURITY + no-BYPASSRLS closes that). Previously every RLS-touching store/service was unit-tested with a *mocked* `$queryRawUnsafe`, so the core multi-tenant isolation guarantee had never been exercised end-to-end.
- Coverage of all three policy families: **tenant_isolation** (users) — own-tenant read / cross-tenant read blocked / fail-closed when no context set / admin-bypass reads across tenants / WITH-CHECK blocks a cross-tenant insert. **tenant_user_isolation** (conversations) — owner reads / same-tenant *different user* blocked / cross-tenant user blocked / admin reads any / WITH-CHECK blocks inserting for another user. **tenant_write + global_read** (documents) — own-tenant read / cross-tenant read blocked / **GLOBAL-tenant read allowed** (global_read SELECT policy) / WITH-CHECK blocks a cross-tenant write / WITH-CHECK blocks a tenant writing *into* the GLOBAL tenant (global_read is SELECT-only).
- The suite drives the real `applyRlsContext` helper inside interactive transactions; seeds ephemeral random-UUID tenants under an admin context (is_admin bypasses WITH CHECK) and cleans them up via tenant-cascade in `afterAll` (GLOBAL-tenant doc deleted explicitly).
- Wired it to be **opt-in and isolated from CI**: gated on `RLS_TEST_DATABASE_URL`, excluded from the default Jest run (`packages/db/jest.config.cjs` `testPathIgnorePatterns`), and run via a dedicated `packages/db/jest.integration.config.cjs` + new `test:integration` script (`pnpm --filter @expertos/db test:integration`). The default `pnpm test` is byte-identical in behaviour — still 849 pass / 0 fail / 0 skip with no DB.
- Verified live: all 15 pass against the running `expertos-pg` (`pgvector/pgvector:pg16`) container.
- Recorded LEARNINGS #7 (Prisma raw-helper `text` param binding → explicit `::uuid`/`::uuid[]` casts needed) and updated the PRD M11.2 manifest note (authz/RLS negative tests now DONE; only `/cso` audit remains).

**Key decisions:**
- **Live container over Testcontainers** — `expertos-pg` is already running with the schema migrated+seeded and `app_user` provisioned, so no image pull / firewall concern; this is the long-deferred "M11 Testcontainers live-DB pass" achieved on the box's existing DB.
- **Connect as `app_user`, not the owner** — the entire point is to exercise the FORCE-RLS path the owner bypasses. Set the container's `app_user` password to `app_user` (`ALTER ROLE`) so the test connects via Docker NAT (pg_hba is `scram-sha-256` for non-127.0.0.1 hosts); transient container state, reflected in the test-header example URL.
- **Raw SQL inserts/reads** (not Prisma model methods) — pins the RLS guarantee at the SQL boundary and lets the test control `tenant_id`/`user_id` exactly, including the cross-tenant/cross-user forgeries the WITH-CHECK tests need.
- **Dedicated integration config + env gate** over an in-file `describe.skip` — keeps the default unit run's "0 skip" count pristine while the live suite runs on demand.

**Files changed:**
- `packages/db/src/rls.integration.test.ts` — NEW; the 15-test live RLS suite.
- `packages/db/jest.integration.config.cjs` — NEW; opt-in integration Jest config (matches `*.integration.test.ts`, no coverage gate, serial, 30s timeout).
- `packages/db/jest.config.cjs` — added `testPathIgnorePatterns` to exclude `*.integration.test.ts` from the default coverage run.
- `packages/db/package.json` — added `test:integration` script.
- `knip.json` — broadened the jest-config ignore glob (`**/jest.config.*` → `**/jest*.config.*`) so the new integration config isn't flagged unused.
- `project-mds/LEARNINGS.MD` — added learning #7 (Prisma raw `text` param binding → `::uuid` casts).
- `project-mds/PRD.md` — M11.2 manifest note: authz/RLS negative tests DONE.
- `project-mds/progress-state.md` + `progress-log.md` — this entry.

**Notes for next iteration:**
- **The live DB (`expertos-pg`, localhost:5432, `app_user`/`app_user`) is the harness for the rest of the deferred raw-SQL validation.** The other stores still only unit-tested with mocked tx — `PgVectorStore` (cosine `<=>` + `ts_rank` keyword), conversation-search `SEARCH_SQL` (`ts_rank`/`ts_headline`/LATERAL + GIN index usage), `PgExpertStore` (`array_agg(DISTINCT)::text[]`), the semantic-cache store, and the `FailedQueryService`/`ExpertPortalService` `LATERAL` joins — can now get real integration tests on this same pattern (admin-context seed → app_user read).
- **Watch LEARNINGS #7:** any new raw-SQL test (or a fix to those stores when they go live) must cast `uuid`/`uuid[]` bind params explicitly (`$n::uuid`), or Postgres aborts with `operator does not exist: uuid = text`. A passing mocked-tx unit test will not catch it.
- **Remaining M11.2:** the `/cso` audit (run the `/security-review` skill over the branch) — the last sub-item; M11.2 stays `[~]` until then.

## M11.2 (COMPLETE) — `/cso` security audit
**Date:** 2026-06-01
**Ref:** PRD M11.2 ("Security tests + `/cso` audit"); §"Security & Compliance"; §"Testing Strategy"

**What was done:**
- Ran the `/security-review` skill over the full branch `m7.2-consultation-booking` diff vs `main` (~17.9k insertions / 142 files): M3–M8 milestones, the consultation/booking funnel + TidyCal webhook, admin & expert portals, raw-SQL reporting services, billing/entitlements, the per-IP rate limiter, prompt-injection hardening, and DB migrations/RLS.
- Methodology per the skill: an identification sub-task over the full diff + repo context (zero candidate findings), then independent verification by me of the highest-risk paths.
- **Verdict: PASS — no HIGH or MEDIUM confidence vulnerabilities.** Recorded as FEEDBACKS Security Cycle 1.
- Independently verified:
  - **SQL injection** — `revenue.service.ts` (`PERIOD_SQL`), `expert-portal.service.ts` (`ANSWERS_SQL`), `failed-query.service.ts` (`INSPECTOR_SQL`) use constant SQL with bound `$1..$N` placeholders; no request value is string-interpolated. `ANSWERS_SQL` is bounded by `c.tenant_id = $1::uuid AND c.expert_id = $2::uuid`.
  - **Elevated-but-bounded RLS** — `expert-portal.service.ts` runs under `is_admin` but re-bounds every query by tenant + expert; `resolveExpert` short-circuits to empty when no expert resolves, so a non-admin can never widen scope.
  - **Webhook HMAC** — `http-tidycal-provider.ts` `verifyWebhook` rejects a missing signature, HMAC-SHA256s the raw body, compares constant-time (`safeEqualHex` w/ length guard), and parses only after verifying.
  - **`@Roles` guards** — present on every new `admin/*`/`expert/*` route; the only `@Public()` route (TidyCal webhook) is authenticated by HMAC.
  - **No XSS** — no `dangerouslySetInnerHTML` in any source `.tsx`.

**Key decisions:**
- Fixed the skill's diff base by pointing `origin/HEAD` at `origin/main` locally (it was unset, which made the skill's `git diff origin/HEAD...` abort).
- Did NOT rely solely on the single identification pass — independently re-read the raw-SQL constants, the expert-portal RLS bounding, and the webhook HMAC compare before signing off, since this is a security gate.
- No code changes: the audit is clean. The deliverables are the documentation updates (FEEDBACKS Cycle 1 + report, PRD manifest M11.2 → `[x]`).

**Files changed:**
- `project-mds/FEEDBACKS.MD` — Security Cycle 1 verdict line (PASS) + full Cycle 1 report inserted after the verdicts block.
- `project-mds/PRD.md` — Task Manifest M11.2 `[~]` → `[x]`; appended the `/cso` audit DONE note + "M11.2 COMPLETE".
- `project-mds/progress-state.md` — new top "Completed" bullet for the audit; Next-tasks M11.2 marked COMPLETE.
- (no source code changed)

**Notes for next iteration:**
- **M11.2 is now fully complete** (prompt-injection + rate-limit + authz/RLS negative tests + `/cso` audit all done).
- **Remaining M11 (all unblocked, no product/legal gate):** M11.1 full E2E Playwright path matrix; M11.3 perf/caching tuning + load smoke test; M11.5 design-system conformance audit (`/design-review`: token usage, citation render-after-resolve, upload-vs-knowledge color distinction, badge tones, hit-target/size minimums).
- **Gated work:** M9 (Concierge) by OD#5 (legal/brand), M10 (analytics) by OD#1, NT.1–NT.6 sign-offs — all need product/legal decisions, not engineering.
- The `/security-review` skill aborts if `origin/HEAD` is unset; set it (`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`) before running, or the diff base can't resolve.

## M11 (hardening) — Live-DB integration tests for PgVectorStore hybrid retrieval
**Date:** 2026-06-01
**Ref:** PRD M11 (§"Testing Strategy"); the deferred "M11 Testcontainers live-DB pass" referenced across the M1.2 / store seam notes — `PgVectorStore` is the keystone RAG path and the first store flagged.

**What was done:**
- Added `apps/api/src/retrieval/pgvector.store.integration.test.ts` — 6 opt-in live-Postgres tests that run the **real** `PgVectorStore` against pgvector (as the non-superuser `app_user` role on the `expertos-pg` container), closing the gaps the mocked-`$queryRawUnsafe` unit suite cannot:
  1. cosine `<=>` ordering near→mid→far; `vectorScore` ≈ 1/0; finite numeric `score`s; pending chunk gated out by the published filter.
  2. keyword full-text match lifts a vector-far Vietnamese chunk to rank 1 via RRF fusion; `ts_rank` `keywordScore` is a number > 0.
  3. `scope = ANY($n::content_scope[])` binds a JS `string[]` (the explicitly-flagged item) — `global_expert`+`tenant_customer` returned, `shared_expert` excluded.
  4. language filter (vi-only).
  5. chunk-status filter (pending-only when asked).
  6. RLS isolation — another tenant sees none of these tenant-scoped (`knowledge`-family) chunks.
- Wired an opt-in integration runner into `apps/api` mirroring `@expertos/db`: new `apps/api/jest.integration.config.cjs` (testMatch `*.integration.test.ts`, no coverage gate, `--runInBand`, 30s timeout) + `test:integration` script; `apps/api/jest.config.cjs` now excludes `*.integration.test.ts` from the default `pnpm test`.

**Key decisions:**
- Colocated the test with the store in `apps/api` (packages/db can't import apps/api code) and added the integration runner there, rather than reimplementing the SQL in packages/db (avoids drift between the test and the real driver).
- Synthetic 1536-dim leading-axis embeddings (`embed(1)`, `embed(1,1)`, `embed(0,1)`) give deterministic cosine ordering with no real embedder; the query vector points along axis 0.
- Every assertion filters to my own seeded chunk IDs — the `knowledge`-family `chunks` table exposes GLOBAL-tenant rows via `global_read`, so the corpus is never assumed empty (the one seeded chunk has no embedding anyway).
- NFC-normalized the Vietnamese content + query: the store's keyword path does NOT normalize (the upstream `retrievalQuerySchema` does), so a direct-driver test must pre-normalize (directive §1.2 / §36).

**Files changed:**
- `apps/api/src/retrieval/pgvector.store.integration.test.ts` — NEW, the 6-test live suite.
- `apps/api/jest.integration.config.cjs` — NEW, the opt-in integration runner config.
- `apps/api/jest.config.cjs` — added `testPathIgnorePatterns` to exclude `*.integration.test.ts` from the default coverage run.
- `apps/api/package.json` — added the `test:integration` script.

**Notes for next iteration:**
- **Runbook (this aarch64/linuxkit sandbox):** the Prisma **library** engine SIGILLs at runtime, so the integration suite needs the **binary** engine. Regenerate first: `PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate`; run: `PRISMA_CLIENT_ENGINE_TYPE=binary RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" pnpm --filter @expertos/api test:integration`; then regenerate the default (library) engine before the gates (`pnpm --filter @expertos/db exec prisma generate`) since typecheck/build also `prisma generate`.
- **Remaining deferred raw-SQL stores** for this same harness (copy the test): conversation-search `ts_rank`/`ts_headline` (`ConversationService.search`), `PgExpertStore` `array_agg`, `PgSemanticCacheStore`, and the `FailedQueryService`/`ExpertPortalService` `LATERAL` joins. Watch LEARNINGS #7 (`$n::uuid` cast on raw uuid params).
- Default suite unchanged: 849 pass / 0 fail / 0 skip; the 6 integration tests run only via `test:integration`.

## M11 (hardening) — Live-DB integration tests for conversation full-text search
**Date:** 2026-06-01
**Ref:** PRD M11 (§"Testing Strategy"); the next deferred raw-SQL store on the "M11 Testcontainers live-DB pass" list, after `PgVectorStore`.

**What was done:**
- Added `apps/api/src/chat/conversation-search.integration.test.ts` — 8 opt-in live-Postgres tests for the M3.3 `ConversationService.search` raw-SQL path (`SEARCH_SQL`: `websearch_to_tsquery('simple', …)` + `ts_rank` + a `ts_headline` guillemet snippet + a `LATERAL` best-message subquery), run as the non-superuser `app_user` role against the running `expertos-pg` container.
- Driven through the **real `ConversationService` + `RlsService`** (not the raw SEARCH_SQL string), so the test also exercises the production RLS-context derivation (`tenantId`/`userId`/`isAdmin` from the `AuthUser`).
- Coverage: (1) message-body match → `«»` snippet + non-null `messageId`, asserts no `<b>` HTML; (2) title-only match → null snippet + null `messageId`; (3) **a different user in the SAME tenant's conversation is invisible** to the searcher (the `user_scoped` `conversations` anchor holds even though `messages` is `tenant_only`); (4) identical `ts_rank` tie broken by `updated_at DESC`; (5) Vietnamese term match through the `'simple'` config (NFC); (6) limit/offset pagination order; (7) empty result for an absent term; (8) a cross-tenant user sees none of the seeded conversations. All 8 pass live.
- Ran the full `apps/api` integration suite (`test:integration`): 14 live tests pass (8 new + 6 existing `PgVectorStore`).

**Key decisions:**
- Test through the real service rather than re-running `SEARCH_SQL` directly — pins both the SQL behaviour AND the RLS-context derivation, and can't drift from the production query string.
- Seed cross-user rows under an admin context (`is_admin` bypasses WITH CHECK); the isolation test then proves a normal user context can't see another user's conversation.
- Explicit `updated_at` timestamps + identical message content make the rank-tie/recency assertion deterministic (ts_rank values are otherwise hard to predict).
- NFC-normalize the VI content + query in the test: the store's keyword path doesn't normalize (the upstream `retrievalQuerySchema` does), so a direct-service test must pre-normalize (directive §1.2).
- `Set<string>` for the owned-id set — `randomUUID()` returns a branded template-literal type that wouldn't accept a plain `r.conversation.id` string in `.has()`.

**Files changed:**
- `apps/api/src/chat/conversation-search.integration.test.ts` — new opt-in live-DB integration suite (excluded from default `pnpm test` by the existing `*.integration.test.ts` ignore pattern; runs via `pnpm --filter @expertos/api test:integration`).

**Notes for next iteration:**
- **Runbook (this aarch64/linuxkit sandbox):** the Prisma **library** engine SIGILLs at runtime, so the integration suite needs the **binary** engine. Regenerate first (`PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate`), run with `PRISMA_CLIENT_ENGINE_TYPE=binary RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" pnpm --filter @expertos/api test:integration`, then regenerate the default (library) engine before the gates.
- **Remaining deferred raw-SQL stores** for this same harness (copy the test): `PgExpertStore` `array_agg`, `PgSemanticCacheStore`, and the `FailedQueryService`/`ExpertPortalService` `LATERAL` joins. Watch LEARNINGS #7 (`$n::uuid` cast on raw uuid params).
- Default suite unchanged: 849 pass / 0 fail / 0 skip; the integration tests run only via `test:integration`.

## M11 — Live-DB integration tests for the remaining four raw-SQL stores/services
**Date:** 2026-06-01
**Ref:** PRD M11 (Hardening; §"Testing Strategy") — the deferred "Testcontainers live-DB pass" backlog flagged across the seam notes, after `PgVectorStore` + conversation-search.

**What was done:**
- Added 4 new opt-in live-Postgres integration suites (as `app_user` against `expertos-pg`, +21 tests; full `apps/api` integration suite now 35 across 6 suites). All pass live.
- `apps/api/src/voice/expert.store.integration.test.ts` (`PgExpertStore`, 5): `array_agg(DISTINCT … ORDER BY …)` language fold + de-dupe → JS `string[]`; active/published join filters (retired expert + draft-only profile excluded); language narrowing; LIMIT bind; `display_name ASC`; cross-tenant RLS on `tenant_only` `experts`/`voice_profiles`.
- `apps/api/src/feedback-inspector/failed-query.service.integration.test.ts` (`FailedQueryService`, 5, through the real service + `RlsService`): `LATERAL` most-recent-question lookup; `cardinality(source_version_ids)=0` insufficient proxy; `helpful=false`-only; cross-tenant read under the admin `is_admin` GUC with null question/model/confidence preserved; newest-first + limit/offset.
- `apps/api/src/expert/expert-portal.service.integration.test.ts` (`ExpertPortalService`, 5): the voice-scope isolation crux (a non-admin expert sees only their own `conversation.expert_id` funnel, never a peer's in the same tenant); `groupBy` conversions aggregate (trigger/response/status + `_sum(amount_cents)` booked revenue); dual-`LATERAL` answer feed (question + latest feedback + insufficient flag); admin targets an expert via `requestedExpertId`; short-circuit-to-empty when no expert resolves.
- `apps/api/src/cache/semantic-cache.store.integration.test.ts` (`PgSemanticCacheStore`, 6): `citations` jsonb round-trip + `sourceVersionIds` derivation; hit-counter increment; `notOlderThan` TTL cutoff; model-tier-in-key miss; `store` replaces-prior (one live row, hits reset); cross-tenant RLS on `tenant_only` `semantic_cache`.

**Key decisions:**
- Drove the elevated-RLS services (`FailedQueryService`, `ExpertPortalService`) through the real service so the production RLS-context derivation is pinned, not just the SQL; drove the two stores (`PgExpertStore`, `PgSemanticCacheStore`) directly with a manually-applied non-admin context to exercise tenant RLS (the `PgVectorStore` precedent).
- Every test scopes to its own random-UUID tenant(s), so the cross-tenant admin reads (failed-query, expert-portal-as-admin) can't be polluted by a concurrent suite; the integration runner is `--runInBand` regardless.
- Explicit `created_at`/`updated_at` intervals instead of `now()` (constant within a transaction) make newest-first ordering deterministic; the failed-query ordering assertion filters to my own rows (the admin read is platform-wide) and checks relative order.
- NFC-normalized any VI fixture content (the keyword paths don't normalize — the schema does upstream).
- Cast every uuid bind `$n::uuid` (LEARNINGS #7), including the nullable `consultation_id`.

**Files changed:**
- `apps/api/src/voice/expert.store.integration.test.ts` — new (5 tests).
- `apps/api/src/feedback-inspector/failed-query.service.integration.test.ts` — new (5 tests).
- `apps/api/src/expert/expert-portal.service.integration.test.ts` — new (5 tests).
- `apps/api/src/cache/semantic-cache.store.integration.test.ts` — new (6 tests).
- (No production code changed — pure test additions; all four files match the `*.integration.test.ts` pattern already excluded from the default `pnpm test`.)

**Notes for next iteration:**
- The deferred raw-SQL store live-DB backlog is now CLOSED — all six paths (`PgVectorStore`, conversation-search, `PgExpertStore`, `PgSemanticCacheStore`, `FailedQueryService`, `ExpertPortalService`) have live integration suites. The only remaining live-DB gap is the *approximate* pgvector cosine match (`PgVoiceExampleStore`, `semantic_cache.embedding`), which awaits the real embedder.
- Runbook unchanged: `PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate` → run with `PRISMA_CLIENT_ENGINE_TYPE=binary RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" pnpm --filter @expertos/api test:integration` → regenerate the default library engine before the gates.
- Remaining M11 engineering: E2E Playwright matrix (M11.1), perf/caching tuning + load smoke (M11.3), design-system conformance audit `/design-review` (M11.5). M11.4 (NT sign-offs) + M9/M10 gates (OD#5/OD#1) need product/legal decisions.

---

## M11.5 — Design-system conformance audit
**Date:** 2026-06-01
**Ref:** PRD §"Design System" + §"Testing Strategy" (Task Manifest M11.5)

**What was done:**
- Mechanized the non-negotiable design-system UI rules as unit tests so a regression fails the build. New `packages/ui/src/primitives.test.ts` (+26 tests) invokes every ds.css primitive directly (the components are pure functions — no DOM renderer or new dependency needed) and asserts:
  - **Cite render-after-resolve** — returns `null` until `resolved` (the front-end half of the citation-resolvability guarantee; never flashed-then-removed).
  - **Source provenance by color** — `.cite` crimson for published knowledge vs `.cite.upload` info-blue for uploaded sources.
  - **Badge** maps every semantic tone to `.badge-<tone>` (status is always a tone-matched badge).
  - **Button** one-crimson-primary default + all variant/size class combos; **Bar/UsageMeter** quota meter (0–100 clamp, NaN/Infinity guard, amber `.bar.warn`, fair-use soft-threshold text "Unlimited"/"x / y"/"x used · fair-use y").
  - Card/Chip/Field/Input/Select/Textarea/Table/Stat/Shell/Topbar/Content.
- Flipped `packages/ui/jest.config.cjs` `collectCoverageFrom` from `*.ts`-only to `*.{ts,tsx}` → all 12 design-system components now report **100% statements/branches/functions/lines**, closing the "component rendering covered by E2E later" gap (E2E M11.1 isn't built and is impractical offline).
- Removed all **rendered emoji** (anti-slop rule "no emoji"): chat feedback 👍/👎 → "Yes"/"No" text buttons (aria-labels "Helpful"/"Not helpful" kept); "☆ Save answer"/"Saved ★" → "Save answer"/"Saved" (chat + history); admin answers `👍 helpful`/`👎 unhelpful` → "Helpful"/"Unhelpful" badges (the green/red tone already conveys sentiment); failed-queries description `(👎)` dropped. Left the 👍/👎 in JSDoc comments (not the rendered trust surface — legitimate documentation of the M3.4 feature).
- Ran the token-usage audit: zero hardcoded hex / inline-px in either app's TSX (the stylelint + eslint `no-restricted-syntax` guards are effective). Typographic arrows →/← are not emoji and were left as-is.

**Key decisions:**
- **Test components by direct invocation, not a renderer.** The primitives are pure functions returning React elements with no hooks, so calling `Cite({...})` / `Badge({...})` and asserting on the returned `el.props.className`/`children` covers every branch without pulling in `react-dom` / `@testing-library/react` / jsdom (which would be undeclared deps and need a network install behind the firewall). Keeps the `node` test environment and adds no dependency.
- **Flip coverage on rather than scope it to tested files.** Since the new test fully covers all 12 components, including them in `collectCoverageFrom` is honest and removes the deferred-coverage debt the old config comment acknowledged.
- **Fix emoji with text, not SVG icons.** The repo has no icon set wired into the apps; text labels are the cleanest design-system-consistent fix (buttons read by text, badges by tone) and keep the change low-risk.
- **Did NOT change ds.css hit-target sizing.** `.btn` (~39px), `.btn-icon` (36px), `.chip` (~33px) are below the PRD's 44px hit-target line, but ds.css is the *visual source-of-truth* — enlarging interactive elements is a design decision with layout ripple, so it's documented as an audit finding for the design owner rather than changed unilaterally.

**Files changed:**
- `packages/ui/src/primitives.test.ts` — NEW: +26 conformance tests for all ds.css primitives.
- `packages/ui/jest.config.cjs` — `collectCoverageFrom` now `*.{ts,tsx}` (components covered, not just helpers); updated the rationale comment.
- `apps/web/app/chat/page.tsx` — feedback buttons 👍/👎 → "Yes"/"No"; save toggle ☆/★ → plain text.
- `apps/web/app/history/page.tsx` — save toggle ☆/★ → plain text.
- `apps/admin/app/answers/page.tsx` — `👍 helpful`/`👎 unhelpful` badges → "Helpful"/"Unhelpful".
- `apps/admin/app/failed-queries/page.tsx` — dropped `(👎)` from the description copy.
- `project-mds/PRD.md`, `project-mds/progress-state.md` — manifest + state updated.

**Gates:** typecheck ✅ (ui/web/admin), `pnpm --filter @expertos/ui test` ✅ (2 suites / 29, 100% coverage), lint ✅ (eslint + stylelint), knip ✅, build ✅ (ui + web + admin; cleared the stale Next PackFileCache first per the deploy note).

**Notes for next iteration:**
- **Hit-target follow-up (needs design sign-off):** if the 44px hit-target rule is to be enforced literally, bump `.btn`/`.btn-icon`/`.chip` min-heights in `packages/ui/src/ds.css` (and re-sync `requirements/ds.css`) — left unchanged here because ds.css is the visual source-of-truth.
- **Remaining M11 engineering:** E2E Playwright matrix (M11.1) + perf/caching tuning + load smoke (M11.3) both need a full running stack (Firebase auth + DB + LLM) — not cleanly doable offline in this sandbox. M11.4 (NT sign-offs) + the M9/M10 gates (OD#5 / OD#1) need product/legal decisions.
- The visual-QA half of M11.5 (live `/design-review` against `requirements/Design System.md` in a browser) is still worth a pass when the apps can be run live; the static/automatable conformance is now enforced by the test suite.

---

## M10.1 — Usage & cost analytics (PRD M10.1)

**What:** Built the first M10 analytics slice — a platform-wide admin usage & cost report over the `usage_logs` ledger. Chose this as the highest-value *buildable* engineering task: M9 is gated on OD#5 (legal), M11.1/M11.3 need a live stack, M11.4/NT need product/legal sign-offs. M10's *instrumentation* (the metrics) is OD#1-independent — only the M10.4 kill-line needs OD#1's PM numbers — so M10.1 is unblocked.

**Decisions:**
- **Mirrored the `RevenueService` admin cross-tenant RLS pattern exactly** — `AnalyticsService.usage` runs inside `RlsService.run` under an admin principal so the `is_admin` GUC reads platform-wide (no `tenant_id` predicate); `@Roles("admin")` on `AnalyticsController` is the boundary. New `AnalyticsModule` imports only `AuthModule` (read-only), registered in `AppModule` after `RevenueModule`.
- **Aggregation split:** per-feature + per-model rollups via Prisma `groupBy` (`_count`/`_sum`); window totals derived by summing the by-feature rollup (no extra aggregate, every row carries a feature_key); the trailing **daily** series + the window-wide **distinct active users** via raw SQL (`date_trunc('day')` + `count(DISTINCT user_id)` have no Prisma Client expression — the M8.3 revenue-series precedent). Postgres `BigInt` `count`/`sum` coerced with `Number()`.
- **Window-wide active users is its own raw scalar** — it can't be summed from the per-day distinct counts without double-counting a user active on several days.
- A null `model` (cache/marker rows, M6.4) surfaces as `"(none)"` rather than being dropped; rollups sorted highest-`costMicros`-first.
- Day granularity (vs revenue's months) because usage is far higher volume; window `days` default 30, max 365.

**Files:**
- `packages/shared/src/analytics.ts` (+ `index.ts` export) — `usageAnalyticsQuerySchema` + DTOs (`UsageAnalyticsDto`/`UsageByFeatureDto`/`UsageByModelDto`/`UsagePeriodDto`).
- `apps/api/src/analytics/{analytics.service,analytics.controller,analytics.module}.ts` + `app.module.ts` registration.
- `apps/admin/app/analytics/page.tsx` + `getUsageAnalytics` in `admin-client.ts` + AdminFrame nav entry.
- Tests: `apps/api/src/analytics/analytics.service.test.ts` (+5), `packages/shared/src/analytics.test.ts` (+4).
- `project-mds/PRD.md`, `project-mds/progress-state.md` — manifest M10.1 → [x], state updated (884 pass total).

**Gates:** typecheck ✅ (11 tasks), new suites pass in isolation (`analytics.service.test.ts` 5/5 @ 100% service coverage; `analytics.test.ts` 4/4), lint ✅ (eslint + stylelint), knip ✅, build ✅ (admin `/analytics` route builds — cleared the stale Next PackFileCache first per the deploy note). Sandbox parallel-`pnpm test` caveat unchanged (per-suite confirmed).

**Notes for next iteration:**
- **M10.2 (consultation funnel + attribution)** is the natural next slice on the same `AnalyticsService` host: question→conversation→recommendation→booking→revenue, `groupBy` over `consultation_recommendations`/`consultations` + the `transactions`/`amount_cents` revenue join — the `ExpertPortalService.conversions` shape but admin platform-wide. Add `GET /admin/analytics/funnel`.
- **M10.3** (concierge metrics) awaits M9; **M10.4** (kill-line) is the only OD#1-gated piece.

## M10.2 — Consultation funnel + attribution
**Date:** 2026-06-01
**Ref:** PRD §"Phase 1 — MVP" → M10.2 ("Consultation funnel + attribution (question→conversation→recommendation→booking→revenue)")

**What was done:**
- New `AnalyticsService.funnel(user, query)` method (`apps/api/src/analytics/analytics.service.ts`) behind a new `GET /admin/analytics/funnel` route (`@Roles("admin")`). Platform-wide cross-tenant funnel report over a trailing `days` window (default 30, max 365): conversation count, recommendations `groupBy` (trigger, response) → total + zeroed `byTrigger`/`byResponse`, funnel-attributed consultations `groupBy` (status) scoped to `recommendations: { some: {} }` → total + zeroed `byConsultationStatus` + booked revenue (`_sum.amountCents` over booked/confirmed/completed).
- New shared DTOs `funnelAnalyticsQuerySchema` + `FunnelAnalyticsDto` in `packages/shared/src/analytics.ts` (importing the trigger/response/status unions from `consultation.ts`/`expert.ts`); exported from the shared index.
- New `apps/admin/app/funnel/page.tsx` ("Funnel" nav entry, Admin group): Stat cards (conversations/recommendations/booked/consultations/revenue + two derived conversion rates), by-trigger table, by-response/by-status badge rows. Reuses `consultationStatusTone`/`funnelResponseTone`/`statusLabel` from `status-tone.ts`. New `getFunnelAnalytics` admin-client fn + AdminFrame nav entry.
- Tests: `apps/api` +3 (`analytics.service.test.ts` funnel block), `apps/shared` +4 (`analytics.test.ts` `funnelAnalyticsQuerySchema`).

**Key decisions:**
- **Attribution scope:** the consultation stage + revenue count ONLY consultations that arose from an in-chat recommendation (`recommendations: { some: {} }`) — "attribution" means tying the booking back to the funnel, so a booking made directly outside the recommendation flow is excluded. Documented in the DTO comment + the page copy.
- **Reused the M8.5 conversions shape + types** (the `ExpertPortalService.conversions` pattern) but admin platform-wide via `RlsService.run` under the admin principal (the `RevenueService`/`AnalyticsService.usage` cross-tenant template — no `tenant_id` predicate; the route guard is the boundary). Did NOT build a new module — `AnalyticsModule` is the analytics host.
- **No BigInt coercion** — used Prisma `count`/`groupBy`/`_sum.amountCents` (Int sums come back as `number`), avoiding the raw-SQL BigInt gotcha the daily/monthly series paths hit.
- **Conversion rates derived in the UI** (the API returns raw counts, consistent with `conversions`).

**Files changed:**
- `packages/shared/src/analytics.ts` — added `funnelAnalyticsQuerySchema` + `FunnelAnalyticsDto`.
- `packages/shared/src/index.ts` — exported the new schema + type.
- `apps/api/src/analytics/analytics.service.ts` — added `funnel()` + module-level TRIGGERS/RESPONSES/CONSULTATION_STATUSES/REVENUE_STATUSES constants + `zeroCounts` helper.
- `apps/api/src/analytics/analytics.controller.ts` — added the `funnel` route.
- `apps/admin/src/lib/admin-client.ts` — added `getFunnelAnalytics` + `FunnelAnalyticsDto` import.
- `apps/admin/src/components/AdminFrame.tsx` — added the "Funnel" nav entry (Admin group).
- `apps/admin/app/funnel/page.tsx` — new dashboard page.
- `apps/api/src/analytics/analytics.service.test.ts` + `packages/shared/src/analytics.test.ts` — tests.

**Gates:** typecheck ✅ (11 tasks), `analytics.service.test.ts` 8/8 @ 100% service coverage, `analytics.test.ts` 8/8, lint ✅ (eslint + stylelint), knip ✅, build ✅ (admin `/funnel` route builds — cleared the stale Next PackFileCache first per the deploy note). Sandbox parallel-`pnpm test` caveat unchanged (per-suite confirmed).

**Notes for next iteration:**
- **No fully-buildable Phase-1 engineering tasks remain offline.** What's left is gate/decision-bound or needs a live stack: M9 (Concierge) GATED by OD#5; M10.3 (concierge metrics) awaits M9; M10.4 (kill-line) awaits OD#1; M11.1 (Playwright E2E) + M11.3 (load smoke) need a live stack (Firebase + DB + LLM); M11.4 + NT.1–6 need product/legal sign-offs.
- **M10.3 is the natural `AnalyticsService` follow-on** once M9 lands (concierge volume/SLA/verdict metrics + knowledge-quality signals) — same admin cross-tenant `groupBy` pattern.

## M9.1 — Admin concierge trigger config
**Date:** 2026-06-01
**Ref:** PRD §"Concierge Mode" → "Admin-configurable trigger mode"; Task Manifest M9.1 (M9 GATED by Open Decision #5)

**What was done:**
- Built the first M9 slice — the admin-configurable concierge (human-review) trigger config — in a way that respects the OD#5 legal/brand gate without being blocked by it. The milestone is gated, but M9.1 is mode-agnostic *config infrastructure*; OD#5 governs which mode an admin may turn on in production + the disclosure copy, not whether the config surface exists. The genuinely-gated silent-delivery path (M9.3) stays unbuilt.
- **Schema/DB:** new `ReviewConfig` model (`review_configs`) — a global singleton, RLS-exempt config like `recommendation_rules`; migration `20260601060000_review_config` (reuses the existing `review_trigger_mode` enum); idempotent seed (create-if-none, defaults to **Off**). Applied + seed-validated against the live `expertos-pg` (one Off row; re-run stays at 1 row).
- **API:** new `apps/api/src/concierge/` module — `ConciergeConfigService` (`getConfig`/`updateConfig`) behind `GET/PATCH /admin/concierge-config` (`@Roles("admin")`). Runs in `RlsService.run` under the admin principal; every save appends an `AdminAuditService` entry in the same tx (`concierge.config_updated`). `AdminModule` now `exports: [AdminAuditService]`; `ConciergeModule` imports it.
- **OD#5 gate:** enabling Mode B (`auto_silent`) is rejected (400) unless the injected `CONCIERGE_ALLOW_SILENT` boolean (resolved once at boot from env, default false) is set. The flag is surfaced on `ReviewConfigDto.silentReviewAllowed` so the UI disables the option.
- **Admin UI:** `apps/admin/app/concierge/page.tsx` (single config form — mode dropdown collapsing enabled+triggerMode, confidence/SLA/volume inputs, Mode-B disabled + amber note when not allowed); `getConciergeConfig`/`updateConciergeConfig` client fns; "Concierge" nav entry (Admin group).
- **Shared:** `packages/shared/src/concierge.ts` — `reviewConfigUpdateSchema` (range-validated), `ReviewConfigDto`, `reviewTriggerModeSchema`/`REVIEW_TRIGGER_MODES`.
- **Tests:** `concierge-config.service.test.ts` (+7, 100% all metrics) + `concierge.test.ts` (+8). Total 906 (api 556, shared 163).

**Key decisions:**
- **Global singleton, no per-expert override** for the consumer MVP (manifest says "global and/or per-expert" — global suffices); per-expert is a documented future extension. Implemented as a manual find→update-or-create (no sentinel id, no Postgres null-unique quirk); seed is create-if-none.
- **Mode-B gate as an injected boolean** (custom provider over a factory reading `process.env.CONCIERGE_ALLOW_SILENT`), not an inline env read — so the service is deterministically testable in both states. This makes the OD#5 legal gate a deploy-time flag flip, not a code change.
- **Audit-in-tx** threaded through the mutation (per the M8.4 backbone rule). `getConfig` returns Off launch-defaults with null `updatedAt` when the DB is unseeded.

**Files changed:**
- `packages/db/prisma/schema.prisma` — `ReviewConfig` model in the Concierge section.
- `packages/db/prisma/migrations/20260601060000_review_config/migration.sql` — new table (+ app_user GRANT, no RLS).
- `packages/db/prisma/seed.ts` — idempotent singleton seed (Off).
- `packages/shared/src/concierge.ts` (new) + `index.ts` exports.
- `apps/api/src/concierge/{concierge.tokens,concierge-config.service,concierge-config.controller,concierge.module}.ts` (new) + `concierge-config.service.test.ts` (new).
- `apps/api/src/admin/admin.module.ts` — export `AdminAuditService`.
- `apps/api/src/app.module.ts` — register `ConciergeModule`.
- `apps/admin/app/concierge/page.tsx` (new) + `src/lib/admin-client.ts` (+2 fns) + `src/components/AdminFrame.tsx` (nav).
- `packages/shared/src/concierge.test.ts` (new); PRD manifest M9.1 → `[x]`.

**Notes for next iteration:**
- **M9.2 (concierge review queue in the expert portal) is the next mostly-mode-agnostic slice.** Build it on the M8.5 `ExpertPortalService` **elevated-but-bounded RLS** pattern (resolve-expert-first, `is_admin` context re-bounded by explicit `tenant_id` + `conversation.expert_id`, short-circuit-empty-when-none) reading `human_review_requests`/`review_responses` (tables already exist) scoped to the reviewer's voice. The host surface is the role-aware `AdminFrame` Expert group.
- **`ConciergeModule` is the M9 host.** A future M9 "should this answer trigger a review?" check (used by `ChatService` on a low-confidence `done` event) reads this config — wire it through the service (don't re-read `review_configs` elsewhere). It must respect `enabled` + `triggerMode` + `confidenceThreshold` + the daily `volumeCapPerDay` (count today's `human_review_requests`).
- **M9.3 (async delivery) is the genuinely OD#5-gated piece** + needs an email provider (swap-seam like `PaymentProvider`/`TidyCalProvider`) — a live-stack dep. Don't build silent push until OD#5/NT.1 sign-off flips `CONCIERGE_ALLOW_SILENT`.
- Sandbox quirk unchanged: full parallel `pnpm test` SIGBUS/SIGILLs random workers (0 assertion failures; 469/414 passed across runs, the rest are "suite failed to run"); per-suite isolated runs are green. Live-DB runbook: binary engine for real queries, regenerate library engine before gates.

## M9.2 — Concierge review queue + reviewer verdict/edit
**Date:** 2026-06-01
**Ref:** PRD §"Concierge Mode" + §"Expert portal" → "Concierge review queue"; PRD Task Manifest M9.2

**What was done:**
- **Enqueue seam** — `apps/api/src/concierge/concierge-queue.service.ts` `ConciergeQueueService.enqueueIfTriggered(user, {messageId, conversationId, insufficientKnowledge, confidence})`, consumed by `ChatService.answerStream` after `persistTurn` (non-fatal hook, the M7.1 recommendation precedent). When the admin config is Mode B (`auto_silent`) enabled and the answer trips the low-confidence trigger (the `insufficientKnowledge` empty-sources proxy, or `confidence ≤ threshold` once a model emits one), it creates a `silent` `HumanReviewRequest` (status `requested`, SLA from config). Runs in an elevated (`is_admin`) context re-bounded to the caller's tenant so the **tenant-wide daily volume cap** count is correct + the insert passes WITH-CHECK; idempotent; over-cap degrades-don't-block.
- **Reviewer seam** — `concierge-review.service.ts` `ConciergeReviewService` (`list`/`get`/`respond`) + `ConciergeReviewController` (`@Roles("expert")` `/concierge-reviews`). Voice-scoped via the M8.5 elevated-but-bounded pattern (resolve expert first → short-circuit empty/404 → every query carries `tenant_id` + `message.conversation.expertId`). `respond` writes a `ReviewResponse` (verdict + optional edit, `edited` derived, `originalAnswer` stamped) and moves the request → `answered` (409 if closed). The `ReviewResponse` row is the audit (no separate `admin_audit_logs`).
- **Admin UI** — `apps/admin/app/concierge-reviews/page.tsx` ("Review queue", Expert nav group): queue + open-to-review inline verdict/edit form; admin picks an expert. New `getConciergeReviews`/`getConciergeReview`/`respondConciergeReview` admin-client fns.
- **OD#5 gate flipped** — `CONCIERGE_ALLOW_SILENT` now defaults allowed (`resolveSilentReviewAllowed` returns `process.env.CONCIERGE_ALLOW_SILENT !== "false"`), reflecting the resolved OD#5/NT.1.
- New shared types in `packages/shared/src/concierge.ts`: `REVIEW_REQUEST_STATUSES`/`reviewRequestStatusSchema`, `REVIEW_VERDICTS`/`reviewVerdictSchema`, `conciergeQueueListQuerySchema`, `reviewResponseCreateSchema`, `ReviewQueueItemDto`/`ReviewQueueDetailDto`/`ReviewResponseDto`/`ReviewVisibilityValue`.

**Key decisions:**
- **Mode-B-only auto-enqueue** — Mode A (`user_prompted`) requires the user to opt in to a review, so its enqueue belongs to the M9.3 user-facing prompt, not this post-answer hook. Keeps the hook unambiguous and avoids queuing reviews the user never asked for.
- **Elevated-tenant-bounded enqueue** — chose this over a per-user RLS insert so the daily volume cap is genuinely tenant-wide ("so the expert team isn't swamped"), matching the PRD intent; `human_review_requests` being `user_scoped` makes a tenant-wide count impossible under the asker's own context.
- **Low-confidence = the existing `insufficientKnowledge` proxy** (no real confidence score exists yet — the echo provider has none), forward-compatible via a `confidence` arg compared against `confidenceThreshold` when a model later emits one. Consistent with M3.4/M7.1's `low_confidence` signal.
- **Prisma Client throughout** (no raw SQL) — `list` is lightweight (answer preview + latest verdict + count), `get` adds one `findFirst` for the prompting question; avoids the raw-SQL/M11-Testcontainers caveat and N+1.
- **No separate audit row** — the `ReviewResponse` (reviewer id + verdict + ts + edit) is the durable record, same stance as the M8.5 expert portal.

**Files changed:**
- `apps/api/src/concierge/concierge-queue.service.ts` — NEW enqueue choke point (+ test).
- `apps/api/src/concierge/concierge-review.service.ts` — NEW reviewer queue/verdict (+ test).
- `apps/api/src/concierge/concierge-review.controller.ts` — NEW `@Roles("expert")` routes.
- `apps/api/src/concierge/concierge.module.ts` — wire both services + controller; export `ConciergeQueueService`.
- `apps/api/src/concierge/concierge.tokens.ts` — flip `resolveSilentReviewAllowed` default to allowed (OD#5 resolved).
- `apps/api/src/chat/chat.service.ts` + `chat.module.ts` — inject `ConciergeQueueService`, call `enqueueIfTriggered` after persist; import `ConciergeModule`.
- `apps/api/src/chat/chat.service.test.ts` — concierge stub + 2 enqueue assertions.
- `packages/shared/src/concierge.ts` + `index.ts` — new review-queue wire types (+ `concierge.test.ts` schema tests).
- `apps/admin/src/lib/admin-client.ts` — `getConciergeReviews`/`getConciergeReview`/`respondConciergeReview`.
- `apps/admin/src/components/AdminFrame.tsx` — "Review queue" Expert nav item.
- `apps/admin/app/concierge-reviews/page.tsx` — NEW reviewer queue page.
- `project-mds/PRD.md` — M9.2 → `[x]`.

**Notes for next iteration:**
- **M9.4 (flywheel) is the natural next slice on this data** — Great/edited `ReviewResponse` → mint a `voice_example` + a `knowledge_draft` (M8.2 `KnowledgeDraftService.create`); Bad → flag the answer's source chunks; inject the correction into conversation context (M3.5's window already keeps the latest turn, so it's M9-safe). Escalate-to-consultation reuses `RecommendationService`/`consultations`.
- **M9.3 (async delivery)** still needs an email-provider abstraction (the `PaymentProvider`/`TidyCalProvider` seam) + the conversation push-back; silent delivery is the OD#5-gated piece (now allowed). A live dep.
- **M10.3 (concierge metrics)** now has `human_review_requests`/`review_responses` to aggregate — the `AnalyticsService` follow-on.
- **Seam-tested with a mocked tx** — the real elevated cross-user enqueue/read + the volume-cap count join the M11 Testcontainers live-DB list (the standing raw-elevated-RLS caveat). `human_review_requests` is `user_scoped`, `review_responses` is `tenant_only`.

## M9.4 — Reviewer-feedback flywheel + escalate-to-consultation
**Date:** 2026-06-01
**Ref:** PRD §"Phase 1 — MVP" → M9.4; §"Concierge Mode" → "Reviewer feedback loop (improves the next answer)"

**What was done:**
- New `ConciergeFlywheelService` (`apps/api/src/concierge/concierge-flywheel.service.ts`) — the global reviewer-feedback flywheel, invoked by `ConciergeReviewService.respond` after the verdict commits (non-fatal). In an elevated (`is_admin`) context re-bounded to the tenant:
  - **great OR edited** → creates a `knowledge_drafts` row (conversation Q&A, → Expert Review → publish/re-embed via the M8.2 pipeline) + an **embedded** `voice_examples` row on the expert's published voice profile (same embedder as voice retrieval; embed outside the tx, raw `INSERT … $7::vector` in a 2nd short elevated tx).
  - **bad** → increments `chunks.flag_count` + sets `last_flagged_at` on the answer's cited knowledge chunks (the M10.3 knowledge-gap signal).
- New chunk-flag columns: schema `Chunk.flagCount`/`lastFlaggedAt` + migration `20260601070000_chunk_flag_signal` (additive, no backfill).
- New `ConciergeReviewService.escalate` (`POST /concierge-reviews/:id/escalate`, `@Roles("expert")`) — opens a `recommended` consultation for the asking user (request `userId`), resolves the consultation type (requested key → active default → untyped), moves the request → `escalated`. Voice-scoped via `loadInVoice` (404/409). Added `userId` to `REQUEST_SELECT`.
- Immediate context injection: `ConversationService.loadHistory` substitutes the latest reviewer-edited revision (`review_responses` where `edited && revisedAnswer != null`, joined to windowed assistant ids) into the replayed prompt context. Displayed message untouched.
- Shared `reviewEscalateSchema` + `ReviewEscalateInput`/`ReviewEscalationDto` (`packages/shared/src/concierge.ts` + index re-exports).
- Module wiring: `ConciergeFlywheelService` provider + `CONCIERGE_EMBEDDING_PROVIDER` (→ `createDefaultEmbeddingProvider`) in `ConciergeModule`.
- Admin UI: `apps/admin/app/concierge-reviews` "Escalate to consultation" action + `escalateConciergeReview` admin-client fn.
- Tests: +22 `apps/api` (flywheel ×12, review +6 escalate/flywheel, conversation +2 context-injection), +3 shared. Final counts: 968 pass (shared 175, ui 29, db 9, ai 149, api 606).

**Key decisions:**
- Flywheel runs *after* the verdict tx and is non-fatal — the recorded verdict is the primary action; a flywheel failure must never roll it back or error the reviewer.
- Voice examples embedded properly (not inert) so they're retrievable — embed outside the DB tx (no network in a tx), insert in a second short elevated tx via raw SQL (Prisma can't write the `Unsupported("vector")` column).
- Context injection via `loadHistory` substitution rather than mutating `message.content` — keeps the displayed answer unchanged so M9.3 owns the visible-vs-silent delivery decision (the `delivered_to_user` flag).
- `bad` and `great/edited` handled independently (a bad+edited both flags chunks and captures the correction).
- Chunk-flag as counter columns on `chunks` (not a new table) — simplest signal store for the M10.3 inspector.

**Files changed:**
- `packages/db/prisma/schema.prisma` — `Chunk.flagCount`/`lastFlaggedAt`.
- `packages/db/prisma/migrations/20260601070000_chunk_flag_signal/migration.sql` — new.
- `packages/shared/src/concierge.ts` + `index.ts` — `reviewEscalateSchema` + DTOs.
- `apps/api/src/concierge/concierge-flywheel.service.ts` — new service.
- `apps/api/src/concierge/concierge-review.service.ts` — flywheel call in `respond`, `escalate`, `resolveConsultationType`, `userId` in select.
- `apps/api/src/concierge/concierge-review.controller.ts` — `escalate` route.
- `apps/api/src/concierge/concierge.module.ts` + `concierge.tokens.ts` — provider + embedding token.
- `apps/api/src/chat/conversation.service.ts` — `loadHistory` context injection + `loadEditedRevisions`.
- `apps/admin/app/concierge-reviews/page.tsx` + `apps/admin/src/lib/admin-client.ts` — escalate UI + client fn.
- Tests: `concierge-flywheel.service.test.ts` (new), `concierge-review.service.test.ts`, `conversation.service.test.ts`, `packages/shared/src/concierge.test.ts`.

**Notes for next iteration:**
- **M9.3 (async delivery)** is the last M9 task: push the reviewer's `ReviewResponse.revisedAnswer` *visibly* back into the conversation (vs Mode-B silent) + a transactional email. Needs a new email-provider abstraction (the `PaymentProvider`/`TidyCalProvider` seam) — a live dep. The M9.4 loadHistory context-injection + the `delivered_to_user` flag are the hooks it builds on. Visible delivery is the OD#5-gated half (now allowed).
- **M10.3 (concierge metrics + knowledge-quality signals)** is now fully unblocked: aggregate `human_review_requests` (volume/SLA — `slaDueAt` vs `answeredAt`), `review_responses` (verdict mix), and the new `chunks.flag_count`/`last_flagged_at` (knowledge-gap) — the `AnalyticsService` admin cross-tenant pattern (M10.1/M10.2). A failed-query-inspector read over flagged chunks is the knowledge-quality surface.
- **Seam-tested with a mocked tx** — the real elevated cross-user writes (`knowledge_drafts`/`voice_examples` raw insert/`chunks.updateMany`) + the `review_responses` join in `loadHistory` join the M11 Testcontainers live-DB list. `voice_examples`/`knowledge_drafts`/`review_responses` are `tenant_only`; `chunks` is `knowledge` (tenant_write); `consultations` is `user_scoped`.
- The minted `voice_examples` embedding uses the offline `HashingEmbeddingProvider` (like all writes here) — when the real embedder lands, both this and retrieval move via `createDefaultEmbeddingProvider`.

## M9.3 — Concierge async delivery (visible update vs silent) + transactional email
**Date:** 2026-06-01
**Ref:** PRD §"Concierge Mode" → "Async delivery"; PRD Task Manifest M9.3 (the final M9 slice)

**What was done:**
- **New email-provider seam (`apps/api/src/email/`)** — the first transactional-email abstraction, mirroring the Stripe/TidyCal swappable-provider pattern:
  - `email-provider.ts` — `EmailProvider` interface (`name` + `send(EmailMessage)`), `EmailMessage` (`to`/`subject`/`text`/`html?`), `EmailDeliveryError`.
  - `offline-email-provider.ts` — `OfflineEmailProvider` default (records `lastMessage`, no network) — keeps the path runnable/testable without a mail provider.
  - `http-email-provider.ts` — `HttpEmailProvider`, a dependency-free generic transactional-email REST driver: structural `EmailHttpClient` (default `fetch`-based `FetchEmailHttpClient`), provider-neutral `{from,to,subject,text,html}` Bearer-JSON envelope.
  - `email.tokens.ts` (`EMAIL_PROVIDER`), `email.defaults.ts` (`createDefaultEmailProvider()` → HTTP driver when `EMAIL_API_URL`+`EMAIL_API_KEY`+`EMAIL_FROM` all set, else offline), `email.module.ts` (provides token + exports `EmailService`).
  - `email.service.ts` — `EmailService`, the single send choke point: logs driver+subject only (no recipient PII), errors propagate (caller decides fatality).
- **New `ConciergeDeliveryService` (`apps/api/src/concierge/concierge-delivery.service.ts`)** — async delivery, invoked by `ConciergeReviewService.respond` after the verdict commits (alongside the M9.4 flywheel), non-fatal + elevated-tenant-bounded (`runSystem` `is_admin` re-bounded to tenant). When the reviewer **edited** the answer: appends the refined answer as a new assistant message marked `refinedFromMessageId`, bumps `conversation.updatedAt`, stamps `review_responses.delivered_to_user=true` (one elevated tx), then sends the email (outside the tx; own try/catch). Verdict-only/unchanged → silent.
- **`messages.refined_from_message_id`** — migration `20260601080000_message_refined_from` (additive nullable scalar uuid, no FK), schema field on `Message`, surfaced on `ChatMessageDto.refinedFromMessageId` via `ConversationService.get`.
- **Web** — `apps/web/app/history/page.tsx` shows a "Reviewed & refined by our team" info badge (title tooltip = the OD#5 "AI-reviewed/edited content" disclosure) on any message carrying the marker.
- **Wiring** — `ConciergeModule` imports `EmailModule` + provides `ConciergeDeliveryService`; `ConciergeReviewService` gains the 4th constructor dep and calls `delivery.deliver(...)` after the flywheel.

**Key decisions:**
- **Delivery gate = `edited`** (a changed answer is the only thing worth re-surfacing). Deterministic; does NOT depend on the request's `visibility` column (every queued request is `silent` today since only Mode B auto-enqueues). "visible update vs silent" = edited→visible-update, unedited→silent.
- **Refined update as a NEW message** (not an in-place content edit) — preserves the original answer for provenance and keeps the M9.4 `loadHistory` context injection (which reads the original message) intact; bumping `updatedAt` sorts the refined conversation to the top of history (so the email's `/history` link lands meaningfully even though the page doesn't yet honor a `?c=` deep-link param).
- **Email best-effort under the in-conversation delivery** (the primary channel): the email send is outside the tx with its own catch, so a mail failure never rolls back the committed push-back.
- **Offline-default email driver** so the whole delivery path is runnable/testable without a live mail provider (the `EchoLlmProvider`/`OfflinePaymentProvider` precedent).
- **`HttpEmailProviderOptions` not exported** (matches `HttpTidyCalProviderOptions`) — knip-clean.

**Files changed:**
- `apps/api/src/email/{email-provider,offline-email-provider,http-email-provider,email.tokens,email.defaults,email.service,email.module}.ts` — new email seam (+ `*.test.ts` for service/offline/http).
- `apps/api/src/concierge/concierge-delivery.service.ts` (+ `.test.ts`) — async delivery.
- `apps/api/src/concierge/concierge-review.service.ts` — inject + invoke delivery after commit.
- `apps/api/src/concierge/concierge.module.ts` — import `EmailModule`, provide `ConciergeDeliveryService`, doc comment.
- `apps/api/src/concierge/concierge-review.service.test.ts` — delivery dep + assertions (async-delivers / null-revision silent / no-delivery-on-409).
- `apps/api/src/chat/conversation.service.ts` (+ `.test.ts`) — `get` selects + surfaces `refinedFromMessageId`.
- `packages/db/prisma/schema.prisma` + `migrations/20260601080000_message_refined_from/migration.sql` — `messages.refined_from_message_id`.
- `packages/shared/src/chat.ts` — `ChatMessageDto.refinedFromMessageId`.
- `apps/web/app/history/page.tsx` — OD#5 refined-update badge.

**Feedback loops:** typecheck 11✓ (one transient `EIO` on `prisma generate` cleared on retry — external-drive flakiness), lint 7✓ + lint:css✓, knip clean, touched suites green (64 tests across the 6 touched files). `email.service.ts` + `concierge-delivery.service.ts` 100% all metrics (coverage scoped check). Full parallel `pnpm test` still hits the documented aarch64/linuxkit Prisma-engine worker SIGABRT (random unrelated suites fail-to-run; 0 assertion failures across runs) — the standing sandbox quirk.

**Notes for next iteration:**
- **M9 is COMPLETE.** Natural next task = **M10.3** (concierge volume/SLA/verdict metrics + knowledge-quality signals): the full dataset now exists — `human_review_requests` (volume by trigger_mode/visibility, SLA breach via `sla_due_at`/`answered_at`, status funnel) + `review_responses` (good/bad/great + edit + `delivered_to_user` rates) + `chunks.flag_count`/`last_flagged_at`. Add an `AnalyticsService.concierge` method (the M10.1/M10.2 admin cross-tenant `RlsService.run`+`groupBy` pattern; coerce raw BigInt counts → Number) + `GET /admin/analytics/concierge` + an admin page.
- **Mode A (`user_prompted`) up-front review prompts are still NOT built** — the queue only auto-enqueues Mode B silent (M9.2). The user-facing "would you like our team to review this?" opt-in + queue-on-opt-in is a future UX slice, distinct from M9.3.
- When wiring a real mail provider, set `EMAIL_API_URL`/`EMAIL_API_KEY`/`EMAIL_FROM` (Secret Manager) and verify the `HttpEmailProvider` envelope field names against the provider's docs (the `fetch` transport needs live network — deploy-time, the Stripe/TidyCal caveat). A future enhancement: have the history page honor the email's `?c=<conversationId>` deep link to auto-open the refined conversation.

## Test Coverage Archive (moved from progress-state.md)
**Date:** 2026-06-01
**Ref:** Housekeeping — progress-state.md was 269KB (target: ~3KB); test changelog and completed narratives were bloating the state file and breaking the AFK agent prompt (126KB prompt → docker sandbox exit code 255).

**What was done:**
- Moved the full test detail changelog from the `- Tests:` line in progress-state.md to this archive entry
- Trimmed progress-state.md completed items to one-line summaries
- The test count summary remains in progress-state.md; detailed per-milestone test breakdowns are below

**Test detail by milestone (as of 986 pass / 0 fail / 0 skip):**

- **M9.3** `apps/api` +18: `email.service.test.ts` ×2 (send delegates+logs driver/subject only / propagates provider failure); `offline-email-provider.test.ts` ×1 (records lastMessage no-network); `http-email-provider.test.ts` ×3 (Bearer JSON envelope w/ from / html-only-when-present / propagates transport failure); `concierge-delivery.service.test.ts` ×9 (pushes refined msg+marks delivered+emails / generic greeting w/o display name / silent-when-unedited / silent-when-no-revision / no-op-when-request-vanished / still-delivers-when-email-fails / stringifies-non-Error-email / swallows-write-failure non-fatal / stringifies-non-Error-write); `concierge-review.service.test.ts` +2 (async-delivers after commit / null-revision verdict-only / no-delivery-on-409); `conversation.service.test.ts` +1 (get surfaces `refinedFromMessageId`). Coverage: `email.service.ts` + `concierge-delivery.service.ts` 100% all metrics.

- **M9.4** `apps/api` +22: `concierge-flywheel.service.test.ts` ×12 (great/edited→draft+embedded voice example / edit-under-non-great-is-positive / bad→deduped non-null chunk flag / verdict-only good→no-op / no-expert→draft-no-voice / no-published-profile→draft-no-voice / long-question→truncated title / no-question→generic title / request-not-found→no-op / bad-no-chunks→no flag / swallows Error + non-Error); `concierge-review.service.test.ts` +6 (respond feeds flywheel after commit / passes original as improvedAnswer for verdict-only / no-flywheel-on-409; escalate opens consultation + status→escalated / falls back to active default type / untyped when no active type / 409 already-answered / 404 not-in-voice); `conversation.service.test.ts` +2 (loadHistory injects latest reviewer-edited revision into context / skips lookup when no assistant messages in window). `apps/shared` +3 (`concierge.test.ts`: `reviewEscalateSchema`). Coverage: 100% all metrics.

- **M9.2** `apps/api` +27: `concierge-queue.service.test.ts` ×11; `concierge-review.service.test.ts` ×14; `chat.service.test.ts` +2. `apps/shared` +9. Coverage: 100% all metrics.

- **M9.1** `apps/api` +7: `concierge-config.service.test.ts` (getConfig/updateConfig including rejects-Mode-B-when-silent-disallowed). `apps/shared` +8. Coverage: 100% all metrics.

- **M10.2** `apps/api` +3: `analytics.service.test.ts` (conversation/recommendation/consultation/revenue funnel). `apps/shared` +4. Coverage: 100% all metrics.

- **M10.1** `apps/api` +5: `analytics.service.test.ts` (per-feature/per-model rollups + daily series). `apps/shared` +4. Coverage: 100% all metrics.

- **M11.5** `packages/ui` +26: `primitives.test.ts` (all 12 ds.css components 100% all-metrics).

- **M11.2** `apps/api` +13: rate-limit service ×6, guard ×7, clientIp tests. `apps/ai` +6: prompt-injection hardening. Admin reconcile +2. `apps/shared` +4. Coverage: 100% all metrics.

- **M8.5** `apps/api` +12: `expert-portal.service.test.ts`. `apps/shared` +5. Coverage: 100% all metrics.

- **M8.4** `apps/api` +42: `admin-expert.service.test.ts` ×20, `admin-audit.service.test.ts` ×4, `admin-user.service.test.ts` ×18. `apps/shared` +24. Coverage: 100% all metrics.

- **M8.3** `apps/api` +28: failed-query ×4, recommendation-rules ×10, entitlement-matrix ×9, revenue ×5. `apps/shared` +27. Coverage: 100% all metrics.

- **Cache invalidation** `apps/api` +3: `lru-cache.test.ts` deletePrefix, `response-cache.service.test.ts` invalidateTenant ×2.

- **M8.2** `apps/api` +18: `knowledge-draft.service.test.ts`. `apps/shared` +11. Coverage: gated 100% lines.

- **M8.1** `apps/api` +16: `knowledge.service.test.ts`. `apps/shared` +4. Coverage: 100% lines/stmts/funcs, 96.4% branch.

- **M7.3** `apps/api` +33: `booking.service.test.ts` ×16, `offline-tidycal-provider.test.ts` ×7, `http-tidycal-provider.test.ts` ×10. `apps/shared` +3. Coverage: 100% all metrics.

- **M7.2** `apps/api` +9: `recommendation.service.test.ts`. `apps/shared` +5. Coverage: 100% all metrics.

- **M7.1** `apps/ai` +15: `recommendation/evaluate.test.ts`. `apps/api` +11. Coverage: 100% all metrics.

- **M6.5** `apps/api` +10: `model-pricing.test.ts` ×6, `usage-log.service.test.ts` ×4. Coverage: 100% lines.

- **M6.4** `apps/api` +27: `lru-cache.test.ts` ×6, `response-cache.service.test.ts` ×9, `semantic-cache.store.test.ts` ×5, `retrieval.service.test.ts` ×2, `chat.service.test.ts` ×6. Coverage: 100% all metrics.

- **M6.3** `apps/ai` +1, `apps/api` +7: entitlement + degrade tests. Coverage: 100% lines / 97.22% branch.

- **M6.2** `apps/api` +55: `billing.service.test.ts` ×27, `offline-payment-provider.test.ts` ×13, `stripe-payment-provider.test.ts` ×15. Coverage: 100% all metrics.

- **M6.1** `apps/api` +19: `entitlement.service.test.ts` ×14, `entitlement.guard.test.ts` ×4, `all-exceptions.filter.test.ts` ×1.

- **M5.4** `apps/ai` +1, `apps/api` +9: upload retrieval + citation tests. Coverage: gated 100% lines.

- **Live-DB integration tests (35 total, run separately via `test:integration`):** 15 RLS (`packages/db`), 6 PgVectorStore, 8 conversation full-text search, 5 PgExpertStore, 5 FailedQueryService, 5 ExpertPortalService, 6 PgSemanticCacheStore.

- **Sandbox note:** full parallel `pnpm test` hits the documented aarch64/linuxkit Prisma-engine SIGILL/SIGABRT quirk (~1 random worker per jest process). Counts confirmed per-suite in isolated runs with zero assertion failures.

**Notes for next iteration:**
- When adding new tests, update only the count in progress-state.md (e.g., `987 pass`). Record the per-test breakdown in your progress-log.md entry instead.

---

## M10.3 — Concierge volume/SLA/verdict metrics + knowledge-quality signals
**Date:** 2026-06-01
**Ref:** PRD.md Task Manifest — Phase 1, M10.3 (§M10 Analytics)

**What was done:**
- Added `AnalyticsService.concierge(user, query)` → `GET /admin/analytics/concierge` (admin-only, the existing `@Roles("admin")` controller). Same admin cross-tenant RLS read pattern as `usage`/`funnel` (the `is_admin` GUC inside `RlsService.run` grants the platform-wide read; no `tenant_id` predicate).
- Four reads over the M9 concierge ledgers, all window-bounded except the cumulative knowledge counts:
  - **Volume** — one `humanReviewRequest.groupBy` over (status, triggerMode, visibility), folded into three zero-initialised breakdowns + the window total.
  - **SLA** — a raw FILTERed aggregate (`SLA_SQL`): `tracked` (has `sla_due_at`), `met` (`answered_at <= sla_due_at`), `breached` (after), `open_overdue` (unanswered `requested`/`in_review` past due, vs a `now` cutoff bound as `$2`), and `avg_response_seconds` → `avgResponseMinutes`. `count() FILTER`/`avg(epoch)` have no Prisma Client expression; constant SQL, both args bound; enum literals cast to `review_request_status`.
  - **Verdicts** — `reviewResponse.groupBy` by verdict + windowed `edited`/`deliveredToUser` counts.
  - **Knowledge quality** — the M9.4 chunk-flagging signal: `flaggedChunks` (cumulative `flag_count > 0`), `totalFlags` (`_sum`), `recentlyFlagged` (windowed via `last_flagged_at`), and a most-flagged top-10 (`flagCount desc, lastFlaggedAt desc`) with collapsed-whitespace excerpts (summary → content fallback). Flag counts are cumulative (no per-event history); only `recentlyFlagged` is windowed.
- Shared wire types in `packages/shared/src/analytics.ts`: `conciergeAnalyticsQuerySchema` + `ConciergeAnalyticsDto`/`ConciergeSlaDto`/`ConciergeVerdictsDto`/`ConciergeFlaggedChunkDto`/`ConciergeKnowledgeQualityDto`, exported from the index.
- Admin UI `apps/admin/app/concierge-analytics/page.tsx` (mirrors `funnel/page.tsx`): window selector + `Stat` headline row (requests, answered, SLA-met %, avg response, verdicts) + SLA badges + by-status table + trigger-mode/visibility/verdict badge rows + cumulative knowledge-quality stats + most-flagged table. Wired `getConciergeAnalytics` in `admin-client` and a "Concierge ops" nav entry (Admin group, after Funnel).

**Tests:** `apps/api` +3 in `analytics.service.test.ts` (full report fold, idle-zeros, excerpt-truncation + window binding). Coverage: 100% all metrics. api 624 → 627; total 989.

**Key decisions:**
- One `groupBy` (status, triggerMode, visibility) folded three ways rather than three separate queries — matches the `funnel` recommendation fold and avoids extra round-trips.
- SLA + chunk aggregates done in SQL/Prisma aggregates (not by pulling rows) to stay consistent with the read-only, no-row-fetch analytics pattern.
- Knowledge-quality flag counts kept cumulative (the design intent of `chunks.flag_count`) with a windowed `recentlyFlagged` companion, instead of forcing a window that the schema can't honour.
- Verdict tone helper kept local to the page (the concierge-reviews page has its own); no shared dependency introduced.

**Gates:** typecheck ✅, test ✅ (100% gate), lint ✅ (incl. stylelint), deadcode/knip ✅, build ✅ (7 workspaces).

## M10.4 — Instrument all validation metrics (validation scorecard)
**Date:** 2026-06-01
**Ref:** PRD Task Manifest M10.4 / §"Open Decisions" #1 (Validation success criteria & kill line — RESOLVED: log all metrics now, no thresholds)

**What was done:**
- New admin analytics report `GET /admin/analytics/validation` — the OD#1 go/no-go scorecard. The fourth admin analytics read alongside usage (M10.1), funnel (M10.2), and concierge (M10.3), same admin cross-tenant RLS pattern.
- `AnalyticsService.validation` folds the four validation dimensions the PRD names into one read:
  - **Activation** — new-user cohort (role=user signed up in window) reaching ≥1 cited answer within 24h of signup (`activatedUsers`/`activationRate`).
  - **Engagement** — distinct active users, total questions, median questions/active user, and new-cohort return rate (asked again 1–7 days after signup).
  - **Willingness to pay** — cumulative: paying/trialing users on a non-free plan vs all users (`freeToPaidRate`).
  - **Funnel** — recommendation→booking conversion + booked consultation revenue per buyer.
- Shared DTOs (`ValidationAnalyticsDto` + sub-DTOs + `validationAnalyticsQuerySchema`), admin client `getValidationAnalytics`, admin page `apps/admin/app/validation/page.tsx` (Stat-card scorecard), nav link "Validation" in the Admin group.
- Tests: +4 api (`validation` describe: full scorecard, empty platform, null-median/4-dp rounding, window-binding) +4 shared (query schema). 997 total.

**Key decisions:**
- Per the OD#1 resolution, the report surfaces **raw numbers + the headline rates** (activation/return/free-to-paid/conversion as fractions in [0,1]) — no thresholds; the PM sets targets post-launch. Median is server-computed (`percentile_cont`) since it can't be derived client-side from counts; for consistency the other rates are computed server-side too via a `ratio()` helper (0 when the denominator is empty, never NaN).
- "Session 1" activation approximated as "within 24h of signup" (the schema has no session concept) — deterministic and documented on the DTO + SQL.
- Willingness-to-pay kept **cumulative** (a current-state stock), unlike the windowed activation/engagement/funnel — mirrors the concierge knowledge-quality cumulative pattern. WTP raw SQL takes no window arg.
- Funnel block computed here (not reusing M10.2) to produce the validation-specific ratios; named `bookingUsers`/`revenuePerBookingUserCents` to avoid confusion with WTP's subscriber `payingUsers`.
- All raw SQL parameterized (`$1` bound dates; WTP fully constant), constant SQL strings — consistent with the M11.2 security-review criteria. Cohort/engagement/funnel reads use raw SQL only where Prisma has no expression (`count() FILTER`, `percentile_cont`, `count(DISTINCT …)`); recommendations + total-users counts stay Prisma.
- Did NOT touch the operator's uncommitted infra/model-pricing WIP (deployment prep) — left out of this commit.

**Files changed:**
- `packages/shared/src/analytics.ts` — validation DTOs + query schema.
- `packages/shared/src/index.ts` — exports.
- `packages/shared/src/analytics.test.ts` — query schema tests.
- `apps/api/src/analytics/analytics.service.ts` — `validation()` method + 4 raw row interfaces + `ratio()` helper + 4 SQL constants.
- `apps/api/src/analytics/analytics.controller.ts` — `GET /admin/analytics/validation`.
- `apps/api/src/analytics/analytics.service.test.ts` — validation tests + `user.count`/`recommendation.count` mocks.
- `apps/admin/src/lib/admin-client.ts` — `getValidationAnalytics`.
- `apps/admin/app/validation/page.tsx` — new scorecard page.
- `apps/admin/src/components/AdminFrame.tsx` — "Validation" nav link.

**Gates:** typecheck ✅, test ✅ (100% gate; new code fully covered), lint ✅ (incl. stylelint), deadcode/knip ✅, build ✅ (7 workspaces, /validation page renders).

## NT.4 — High-stakes-topic detection, disclaimers + consultation-routing (technical enforcement)
**Date:** 2026-06-01
**Ref:** PRD §"Non-Technical Requirements" (NT.4) / Task Manifest M11.4

**What was done:**
- Built a deterministic high-stakes detector (`packages/ai/src/high-stakes/`): pure, offline, no IO/clock/RNG — like the prompt builder and recommendation engine. Curated financial/legal/medical/tax keyword lists (EN + VI), matched whole-word over the shared NFC `tokenize` so "tax" hits "income tax" but not "syntax" and Vietnamese diacritics stay whole (directive §36). Returns the matched categories + terms, or null.
- Threaded one detection (`detectHighStakes(input.text) !== null`) through every seam in `ChatService.answerStream` (fresh + cached paths):
  1. **Prompt**: `buildAnswerPrompt` gains an optional `highStakes` flag → an educational-scope system rule (general context only, no personalized advice; "the interface adds the disclaimer" — mirrors the existing "AI rendition" UI-surfaces-the-label rule).
  2. **Disclaimer**: single-sourced `HIGH_STAKES_DISCLAIMER` in `@expertos/shared`, surfaced on `ChatMessageDto` + the chat `done` event, rendered as a notice on the live turn AND the history read path.
  3. **Logging**: `high_stakes` boolean on `messages` + `usage_logs` (migration `20260601090000`) for monitoring.
  4. **Routing**: the M7 `topic` recommendation trigger now fires on the detector signal as well as its configured keywords, so the "book a consultation" CTA reliably accompanies the disclaimer even when an admin left the topic keywords empty (a disabled topic rule still never fires).
- Tests: detector unit suite (8 cases incl. multi-category, whole-word, VI NFD); evaluate engine high-stakes-topic firing + non-revival of disabled/non-topic rules; answer-prompt scope-rule presence/absence; usage-log/conversation persistence + read-path flag; chat-service end-to-end thread-through (high-stakes, everyday, cache-hit).

**Key decisions:**
- **Disclaimer + scope-rule + log are a non-negotiable legal gate (always fire on detection); the consultation CTA is admin-tunable (the M7 topic rule).** Cleanly separates the liability disclaimer from the upsell — the disclaimer always shows; the admin still owns whether/how to recommend.
- **Detect on the question only**, computed once before the prompt is built — deterministic and available pre-stream, matching the PRD examples ("should I sue my landlord?", "what medication should I take?"). Reused across fresh + cached paths.
- **Keyword lists kept deliberately broad** — a missed disclaimer is the costly failure, an extra one merely cautious (PRD: append "when triggered").
- Surfaced the flag via structured DTO/Message fields (not by mutating answer prose), following the OD#5 "AI-reviewed content" indicator pattern, so it renders identically live and in history and never collides with the streamed text.
- Marked NT.4 `[~]` not `[x]`: the technical enforcement is complete, but NT.4 is a sign-off gate — the PM/legal review of the disclaimer copy + ToS coverage is a human action I can't grant.

**Files changed:**
- `packages/ai/src/high-stakes/{types,detect,detect.test}.ts` — new detector + tests.
- `packages/ai/src/index.ts` — export `detectHighStakes`, `HIGH_STAKES_CATEGORIES`, types.
- `packages/ai/src/prompt/{types,answer-prompt}.ts` + `answer-prompt.test.ts` — `highStakes` input → educational-scope section.
- `packages/ai/src/recommendation/{types,evaluate}.ts` + `evaluate.test.ts` — `highStakes` signal; topic trigger fires on it.
- `packages/shared/src/chat.ts` + `index.ts` — `highStakes` on `ChatMessageDto` + `done` event; `HIGH_STAKES_DISCLAIMER` const.
- `packages/db/prisma/schema.prisma` + `migrations/20260601090000_high_stakes_topic/` — `high_stakes` column on `messages` + `usage_logs`.
- `apps/api/src/chat/chat.service.ts` — detect once, thread through prompt/persist/usage/recommend/done (both paths).
- `apps/api/src/chat/conversation.service.ts` — persist + select + map `highStakes`.
- `apps/api/src/observability/usage-log.service.ts` — `highStakes` on the usage entry.
- `apps/api/src/consultation/recommendation.service.ts` — `highStakes` on `RecommendationInput` → signals.
- `apps/web/app/chat/page.tsx` + `app/history/page.tsx` — render the disclaimer notice.
- Test files updated for the new required fields (conversation/recommendation/usage-log/chat service).

**Gates:** typecheck ✅, test ✅ (1013 pass; new code 100% covered, gate met), lint ✅ (incl. stylelint), deadcode/knip ✅, build ✅ (7 workspaces).

**Notes for next iteration:**
- NT.4 still needs the **human** PM/legal sign-off on the disclaimer copy + ToS coverage before launch (the code gate is done). NT.3 (data-retention policy publish) is the other open NT besides the deferred NT.5/NT.6.
- The detector is question-only by design; if a future need arises to catch high-stakes content that only surfaces in the answer, extend `ChatService` to also detect on `built.text` (the recommendation engine already scans question+answer for its keyword path).
- Keyword lists are curated constants in `detect.ts` — broaden there if real traffic shows misses; no config table (kept deterministic, unlike the admin-tunable recommendation rules).

## M11.1 — Full E2E path matrix (Playwright) — harness + specs
**Date:** 2026-06-01
**Ref:** PRD §"Testing Strategy" (M11 Hardening, M11.1)

**What was done:**
- Stood up a new opt-in `e2e/` workspace (added to `pnpm-workspace.yaml` + `knip.json`). It has no `test` script, so Turbo's `pnpm test` never runs it — same opt-in convention as the live-DB integration suites in `packages/db`/`apps/api`. Run it with `pnpm --filter @expertos/e2e test:e2e`.
- `playwright.config.ts`: single-worker ordered run; `webServer` array boots/attaches api(:3001 /health) + web(:3000) + admin(:3002) with the NEXT_PUBLIC_* the clients need (incl. the Auth-emulator host); `E2E_NO_WEBSERVER=1` to skip when the operator runs the apps. HTML+list reporters, trace/screenshot/video on failure.
- Auth fixtures (`fixtures/auth.ts`): `signIn`/`signInAdmin` drive the **real** UI sign-in path against the Firebase **Auth emulator** popup widget (shared `clickGoogleSignInAndDrivePopup` reuses an existing emulator account or creates one); `getEmulatorIdToken` mints an ID token via the emulator REST API for API-level setup (used by data-deletion to mirror a target user row via `GET /me`).
- `fixtures/env.ts` centralizes every URL/credential/toggle (dev defaults, env overrides) + 4 deterministic test identities (member/other/expert/admin). `fixtures/web-actions.ts` has accessibility-first chat helpers (`gotoChat`/`ask`/`saveLastAnswer`).
- 7 spec files / 18 discovered tests, grounded in the actual rendered DOM (roles/labels/placeholders read from the app, not invented): `web-chat` (ask→answer→save, helpful-feedback+reason, NT.4 high-stakes disclaimer [deterministic detector], insufficient-knowledge next step), `web-voice-and-consultation` (M2.2 voice rendition + M7.2 book — guarded/skip when no seed), `web-history` (M3.3 search + M3.2 saved answers + rename), `web-upload` (M5.3 in-memory CSV→searchable chunks + unsupported-type red-badge rejection), `admin-portal` (role-aware nav + M8.1 review-gate queue + expert-vs-admin nav gating), `account-billing` (M6.3 plan + usage meter), `data-deletion` (M8.4 record-deletion-request).
- Enabler: env-guarded `connectAuthEmulator` wiring added to web + admin `firebase.ts` (runs only when `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is set — prod no-op). Documented the two emulator vars in `.env.example`.
- `e2e/README.md`: full live-stack prerequisites (Postgres+pgvector seed, Auth emulator, 3 services), test identities/roles, run commands, env override table.

**Key decisions:**
- **Opt-in workspace, not part of `pnpm test`.** E2E needs a live stack the default gate can't provide; mirroring the project's existing opt-in integration-test pattern keeps `pnpm test` green (still 1013) while landing the harness.
- **Emulator popup auth over a token-injection bypass.** Exercises the real `signInWithPopup` code path and avoids adding any auth bypass to the API (firebase-admin already honors `FIREBASE_AUTH_EMULATOR_HOST`). Only a tiny, prod-safe client wiring was needed.
- **Flow-level assertions, not model-output assertions.** Specs assert the contract (turn completes, affordance appears, badge shows) so they're robust to whatever knowledge is seeded; seed-dependent paths (expert voice, consultation) `test.skip` when absent.
- **3 honest `test.fixme` legs** for flows whose UI/seed prerequisite isn't present yet (consumer self-serve checkout CTA — not built in apps/web; full publish→retrieval round-trip — needs a freshly-ingested Draft; irreversible deletion cascade — would wipe shared seed). Keeps the matrix represented without flaky/fictional tests.

**Files changed:**
- `pnpm-workspace.yaml` — add `e2e` workspace
- `knip.json` — add `e2e` workspace (config + `*.spec.ts` entries)
- `.env.example` — document `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`
- `apps/web/src/lib/firebase.ts`, `apps/admin/src/lib/firebase.ts` — env-guarded `connectAuthEmulator` (prod no-op)
- `e2e/package.json`, `e2e/tsconfig.json`, `e2e/.gitignore`, `e2e/playwright.config.ts`, `e2e/README.md`
- `e2e/fixtures/env.ts`, `e2e/fixtures/auth.ts`, `e2e/fixtures/web-actions.ts`
- `e2e/specs/{web-chat,web-voice-and-consultation,web-history,web-upload,admin-portal,account-billing,data-deletion}.spec.ts`

**Verification:**
- Verified here: `pnpm typecheck` (12 ✅), `pnpm lint` (incl stylelint ✅), `pnpm test` (1013 pass, e2e correctly excluded), `pnpm deadcode` (knip ✅), `pnpm build` (7 ✅), and `playwright test --list` discovers all 18 tests / 7 files (config + specs parse).
- NOT verified here: an actual browser run — needs the live stack (Postgres+pgvector + Auth emulator + 3 services + seed) + `playwright install chromium`, which the sandbox/CI doesn't provide.

**Notes for next iteration:**
- To run green, bring up the stack per `e2e/README.md`, seed (`pnpm --filter @expertos/db db:seed`), grant expert/admin roles to the `e2e-expert@`/`e2e-admin@` identities, then `pnpm --filter @expertos/e2e exec playwright install chromium && pnpm --filter @expertos/e2e test:e2e`.
- The emulator popup-widget selectors (`Add new account` / `Auto-generate user information` / `Sign in with Google.com`) are based on the documented Firebase Auth emulator widget; if a Firebase version changes them, adjust `clickGoogleSignInAndDrivePopup` in `e2e/fixtures/auth.ts`.
- M11.1 left `[~]` (not `[x]`): the harness + buildable specs are done but the suite is unexecuted here and 3 legs are `fixme`. Resolve the fixmes as the consumer checkout CTA / ingestion-driven publish path land.
- This unblocks M11.3 (load smoke) which needs the same live stack.

## M11.3 — Performance / caching tuning + load smoke test
**Date:** 2026-06-01
**Ref:** PRD §"Testing Strategy" / Phase 1 M11.3

**What was done:**
- **Cache instrumentation (the "tuning" enabler — you can't size a cache you can't measure):**
  - `apps/api/src/cache/lru-cache.ts`: cumulative `hits`/`misses`/`evictions`/`expirations` counters on the in-process `LruCache` + a `stats()` snapshot (`size`, `maxEntries`, the four counters, derived `hitRate`). `get()` now distinguishes a never-seen miss from a TTL-expiry miss (the latter bumps both `expirations` and `misses`); `set()`'s capacity loop bumps `evictions`.
  - `apps/api/src/cache/response-cache.service.ts`: per-instance semantic-tier hit/miss counters (the DB lookup, not an LRU) + a `stats()` that folds all three M6.4 layers — retrieval LRU, answer-memory LRU, persistent semantic — into `CacheAnalyticsDto`, with a combined `answerOverall { lookups, served, hitRate }` (every `lookupAnswer` consults memory first, so memory hits+misses is the total; a lookup is "served" by a memory **or** semantic hit).
  - `packages/shared/src/analytics.ts`: new `CacheLayerStatsDto` + `CacheAnalyticsDto` (exported from the shared index).
  - `apps/api/src/analytics/analytics.controller.ts`: admin-guarded `GET /admin/analytics/cache` delegating straight to `ResponseCacheService.stats()` (no branchy logic, no DB read, no window); `AnalyticsModule` now imports `CacheModule` for the singleton.
- **Load smoke harness:** `load/smoke.mjs` — a dependency-free Node driver (global `fetch` + `node:perf_hooks`). Fixed-concurrency timed phases over `health` (unauth), `me/entitlements` (authed read), and a cache-warming `chat` leg (one repeated question so the answer cache engages: cold first turn → hot thereafter). Per-phase p50/p95/p99 + rps + error rate; gated on `LOAD_P95_MS` and `LOAD_MAX_ERROR_RATE` (exit 1 on breach so it can gate a deploy); optionally GETs `/admin/analytics/cache` after the run to print hit rates. `load/README.md` documents the env surface + the live-stack prerequisites.
- Tests: +3 `LruCache` (zeroed snapshot, hit/miss/expiry counters, eviction count) and +4 `ResponseCacheService.stats` (zeroed, retrieval+memory hit/miss, semantic-hit fold-in, full miss). 1013 → 1020 pass; api 635 → 642. All gates green (typecheck, test ≥90% coverage, lint, knip, build).

**Key decisions:**
- **Top-level `load/` dir, not a pnpm workspace.** The driver has zero deps, so unlike the Playwright `e2e/` workspace it needs no `node_modules`; keeping it a sibling of `infra/` (a `load/**` knip-ignore entry) keeps it out of the default turbo/jest/knip gates while staying opt-in/live-stack only.
- **Endpoint, no admin dashboard page.** The other M10 analytics have admin pages, but cache stats are **per-instance** (in-process counters) — a cross-tenant "dashboard" of them would mislead on a multi-instance deployment. The endpoint is the right surface: an ops/load-smoke signal the harness reads, with the per-instance caveat documented in the DTO doc + README. No new admin UI.
- **No config change to `cache.config.ts`.** "Tuning" without production traffic would be guessing; the deliverable is the *observability* that lets the sizes be set from real eviction/expiry counts post-launch. Left the conservative M6.4 defaults intact.
- Counted a TTL-expiry as both an `expiration` and a `miss` so `hitRate = hits/(hits+misses)` stays honest while `expirations` still isolates "too short a TTL" from "never seen."

**Files changed:**
- `apps/api/src/cache/lru-cache.ts` — hit/miss/eviction/expiration counters + `stats()`.
- `apps/api/src/cache/response-cache.service.ts` — semantic-tier counters + three-layer `stats()`.
- `apps/api/src/cache/lru-cache.test.ts`, `.../response-cache.service.test.ts` — +7 tests.
- `apps/api/src/analytics/analytics.controller.ts`, `analytics.module.ts` — `GET /admin/analytics/cache`.
- `packages/shared/src/analytics.ts`, `src/index.ts` — `CacheLayerStatsDto` / `CacheAnalyticsDto`.
- `load/smoke.mjs`, `load/README.md` — new opt-in load smoke harness.
- `knip.json` — ignore `load/**`.

**Note for reviewers (env, not code):** a stale `apps/admin/.next/cache` can fail the admin standalone build with `Unexpected end of JSON input` / `Expected end of object`; `rm -rf apps/admin/.next/cache` clears it. Typecheck/pages are unaffected.

## NT.3 — Data-retention sweeper (technical enforcement)
**Date:** 2026-06-01
**Ref:** PRD §"Non-Technical Requirements" → "Data-retention + deletion policy" (NT.3)

**What was done:**
- Built `RetentionService` (`apps/api/src/admin/retention.service.ts`) — the auto-delete "sweeper" the published policy promises and the M5.2 upload pipeline has referenced in comments all along but which never existed. Two ops:
  - `preview(actor)` — non-destructive dry run, counts eligible rows per category.
  - `sweep(actor)` — deletes them, writes one immutable audit entry in the same transaction, returns the counts.
- Three side-effect-free deletion classes: `temporary` uploads past their stamped `expires_at` (chunks cascade), conversations idle past the window by `updated_at` (messages/citations/feedback/saved cascade), usage logs past the window by `occurred_at`.
- Runs under the admin RLS context (`is_admin` GUC → cross-tenant `deleteMany`, permitted by the `FOR ALL … is_admin()` policies).
- Env-tunable windows via `retention.config.ts` (`RETENTION_CONVERSATION_DAYS` / `RETENTION_USAGE_LOG_DAYS`, default 730 = the 2-year policy value); typo-guarded positive-int parse. Temporary-upload expiry honours the per-row stamp, not a global constant.
- Routes: `GET /admin/retention/preview` + `POST /admin/retention/sweep` (`@Roles("admin")`), Cloud-Scheduler-triggerable (no in-app cron, per §"No full infra Day 1").
- Shared DTOs (`packages/shared/src/retention.ts`): `RetentionCounts` / `RetentionPreviewDto` / `RetentionSweepResultDto`.
- Admin UI: `apps/admin/app/retention/page.tsx` (preview stats + Run-sweep + result card), nav entry under Admin → "Data retention", client fns `getRetentionPreview`/`runRetentionSweep`.
- Tests: `retention.service.test.ts` (5) + `retention.config.test.ts` (4), service 100% all metrics. api 642→651.

**Key decisions:**
- **Admin-triggered, not an in-app cron.** The repo has no scheduler dependency and §"No full infra Day 1" says don't add one; an admin route a Cloud Scheduler job hits keeps it dependency-free and matches the existing reconcile pattern.
- **Honour the stamped `expires_at` for uploads, not `TEMPORARY_RETENTION_DAYS`.** The constant is 7 (vs the policy DRAFT's 90); the per-row stamp is the authoritative TTL, so the sweep is decoupled from that mismatch and stays correct if the stamp ever varies.
- **Deliberately excluded consultation transcripts + concierge records.** The policy calls for *anonymize-not-delete* on concierge records, and deleting consultations would distort historical revenue/MRR reporting — both need their own non-deletion treatment, flagged as a follow-up rather than bolted on with wrong semantics.
- One shared `cutoffs()` computed from a single `now` (with a clock seam) so preview and sweep agree and tests are deterministic.

**Files changed:**
- `packages/shared/src/retention.ts` (new), `packages/shared/src/index.ts` — DTOs + export.
- `apps/api/src/admin/retention.{service,controller,config}.ts` (new) + `.test.ts` (2 new) — service/route/config.
- `apps/api/src/admin/admin.module.ts` — register controller/service + `RETENTION_POLICY` factory.
- `apps/api/src/uploads/upload-content-types.ts` — comment now points at the real `RetentionService` (was "a future sweeper job").
- `apps/admin/app/retention/page.tsx` (new), `apps/admin/src/lib/admin-client.ts`, `apps/admin/src/components/AdminFrame.tsx` — admin UI + nav.
- `project-mds/PRD.md` — NT.3 manifest + section → `[~]` technical-enforcement-done.

**Notes for next iteration:**
- NT.3 now has the same shape as NT.4: technical enforcement done, **human gate remains** (PM approval + publication of the policy DRAFT). Not code.
- Follow-up (left intentionally): consultation-transcript expiry (delete `consultation_notes` only, keep the consultation row for revenue) + concierge-record anonymization (null/scrub PII past 1yr rather than delete).
- Sweep runs the deletes in one transaction; fine at MVP scale. If row counts grow large, batch the `deleteMany` per category to bound lock duration.

---

## NT.3 follow-up — consultation-transcript expiry + concierge-record anonymization
**Date:** 2026-06-01
**Ref:** PRD §"Non-Technical Requirements" → NT.3 / "Data Retention & Deletion Policy"; follow-up flagged in the prior NT.3 entry

**What:** Extended the data-retention sweeper (`RetentionService`) to enforce the two policy classes that were deliberately left out of the first cut because they carry value beyond their free text. Both honour the policy's distinction (keep the structural/revenue row, remove the personal content):

- **Consultation transcripts** — `consultation_notes` past **1 year from the consultation date** (`scheduledAt ?? createdAt`, via a Prisma relation filter on the parent) are **deleted**, while the parent `consultations` row (status / amount / booking) is **kept** so historical revenue/MRR reporting is undistorted. This reconciles the policy table's "Consultation transcripts → Auto-delete: Yes" with the revenue-integrity concern: the *transcript* (notes) is the deletable part, not the consultation record.
- **Concierge review records** — `review_responses` past **1 year** are **anonymized in place** (`updateMany`: `originalAnswer → "[redacted]"`, `revisedAnswer/notes → null`) rather than deleted, so the structural row the M10.3 concierge analytics read (verdict / timing / SLA / delivered flag) survives. This is the policy's "anonymized after retention" line. Idempotent via the `[redacted]` sentinel as an idempotency marker (`originalAnswer: { not: "[redacted]" }` in the where) — previews don't over-count and re-running the sweep is a no-op for already-scrubbed rows.

**Files:**
- `packages/shared/src/retention.ts` — added `consultationTranscripts` + `conciergeRecords` to `RetentionCounts`; rewrote the module doc (5 categories: 3 deletions + 2 value-bearing).
- `apps/api/src/admin/retention.config.ts` — added `consultationTranscriptDays` (365) + `conciergeRecordDays` (365), env knobs `RETENTION_CONSULTATION_TRANSCRIPT_DAYS` / `RETENTION_CONCIERGE_DAYS`; non-positive/unparseable overrides still fall back so a typo can't collapse a window.
- `apps/api/src/admin/retention.service.ts` — two new cutoffs, two new `where` helpers (`expiredTranscriptWhere` relation filter, `anonymizableReviewWhere` with the idempotency guard), the delete + anonymize ops in the existing in-tx sweep, audit metadata + log fields extended. The `REDACTED` sentinel lives here.
- `apps/admin/app/retention/page.tsx` — two new preview/result `Stat`s + reworded the policy blurb.
- Tests: `retention.service.test.ts` (preview counts both new categories; sweep delete-transcript-keeps-row, anonymize-not-delete-and-skip-redacted, audit metadata, custom windows) + `retention.config.test.ts` (defaults / overrides / fallbacks for the two new knobs).

**Gates:** typecheck ✅, test ✅ (api 651→653; total 1031), lint ✅ (incl. stylelint), build ✅, deadcode (knip) ✅.

**Notes for next iteration:**
- NT.3 technical enforcement is now complete across all listed data classes; what remains is the **human gate** (PM approval + publication of the policy DRAFT).
- Anonymization currently scrubs only `review_responses`. If `human_review_requests` ever gains free-text fields beyond `confidence_score`, extend `anonymizableReviewWhere`'s sibling there too.
- Consultation-transcript deletion keys off the parent consultation date via a relation filter; at large scale consider an indexed denormalized date on `consultation_notes` if this `deleteMany` gets slow.

## M6.2 (web) — Self-serve checkout CTA in the consumer app
**Date:** 2026-06-01
**Ref:** PRD §"Paywall, Entitlements & Feature Gating" (M6.2); closes the M11.1 `account-billing.spec.ts` consumer-checkout `test.fixme`

**What was done:**
- Added `GET /me/plans` (`EntitlementService.listUpgradePlans` + `EntitlementsController`) returning the priced upgrade tiers above the acting user's current plan (`AvailablePlansDto`: `currentPlanKey`, `hasActiveSubscription`, `upgrades[]` with per-interval prices), filtering out unpriced plans (can't be checked out).
- Wired the consumer web `apps/web/app/account` page to the existing-but-previously-unreachable billing API: Upgrade buttons → `POST /billing/checkout` (hosted Stripe redirect), a Manage-billing button → `POST /billing/portal` (shown only when `hasActiveSubscription`). New `account-client.ts` helpers `fetchUpgradePlans`/`startCheckout`/`openBillingPortal`.
- Replaced the M11.1 `test.fixme("free user … upgrades via checkout")` with a real `test` asserting the upgrade CTA renders; narrowed the remaining fixme to just completing the Stripe-hosted page (an external surface the suite shouldn't automate).

**Key decisions:**
- Plan listing lives in `EntitlementService` (not `BillingService`) because it already resolves the actor's current plan + tier ordering; checkout/portal hand-off stays in `BillingService`. The `/me/plans` read runs under the actor's RLS context for the current-plan resolution even though plans/prices are global reference data.
- `hasActiveSubscription` is derived as `plan.key !== free` — a paid resolved plan implies a live subscription; avoids a second query. The portal route already 400s gracefully if no provider customer exists.
- Checkout buttons use the `dark` Button variant (not crimson `primary`) to respect the M11.5 "one crimson primary per view" design rule with multiple upgrade options.
- Redirect targets stay server-chosen (never sent from the client) — the existing open-redirect-safe contract is preserved; the client only sends `planKey`/`interval`.

**Files changed:**
- `packages/shared/src/billing.ts` (+ `index.ts`) — `PlanPriceDto`/`UpgradePlanDto`/`AvailablePlansDto`.
- `apps/api/src/entitlements/entitlement.service.ts` — `listUpgradePlans`; `entitlements.controller.ts` — `GET /me/plans`.
- `apps/api/src/entitlements/entitlement.service.test.ts` — +2 tests (free-user priced upgrades w/ unpriced filtered; top-plan no-upgrade + active flag).
- `apps/web/src/lib/account-client.ts` — `fetchUpgradePlans`/`startCheckout`/`openBillingPortal`.
- `apps/web/app/account/page.tsx` — upgrade CTA + manage-billing UI, price formatting, redirect orchestration.
- `e2e/specs/account-billing.spec.ts` — real upgrade-CTA test; narrowed fixme.

**Tests:** api 653 → 655; suite 1031 → 1033 pass / 0 fail. typecheck/lint/deadcode/build all green.

## M11 harness — local live-DB integration runner (executed green: 50 tests)
**Date:** 2026-06-01
**Ref:** PRD §"Testing Strategy" / Task Manifest M11.1 + M11.2; "next task: execute against a live stack"

**What was done:**
- Verified the opt-in live-DB integration tier — previously documented as "not runnable in CI/sandbox" — actually runs **green** against a local pgvector container:
  - `packages/db` `rls.integration.test.ts` — 15 RLS negative tests (tenant_isolation / tenant_user_isolation / tenant_write+global_read) as the non-superuser `app_user` role.
  - `apps/api` 6 suites (PgVectorStore, conversation search, expert store, semantic cache, expert portal, failed-query) — 35 tests.
- Converted the manual setup into a committed, repeatable harness: `infra/local-test-db.sh` (`up` / `test` / `down` / `all`) + root `pnpm test:integration`. It pulls/starts `pgvector/pgvector:pg16`, waits for readiness, `prisma migrate deploy` + `db:seed` as owner, `ALTER ROLE app_user WITH LOGIN` (migrations create it `NOLOGIN`), then runs both suites with `RLS_TEST_DATABASE_URL` pointed at the `app_user` connection. No GCP dependency (unlike `infra/dev-setup.sh`).
- Documented it in `infra/README.md` (new "Live-DB integration suites" subsection).

**Key decisions:**
- Scoped to the **DB/api integration tier**, not the full Playwright E2E stack. The Playwright path is blocked in this sandbox on chromium Linux system-deps (`validateDependenciesLinux`) + a `firebase-tools` Auth emulator + 3 running services — a much larger, riskier surface. The live-DB tier is the high-value, low-risk, fully-verifiable slice, so I delivered that as a durable artifact rather than chasing the browser stack.
- `app_user` is granted LOGIN only in the local harness (a throwaway container); the migration deliberately ships it `NOLOGIN` because prod migrations/seeds run as the owner and the app connects with a managed password (per DIRECTIVES §4.21). The harness mirrors prod's RLS-enforcing connection without weakening the migration.
- Seed is required before the RLS suite: it inserts a GLOBAL-tenant `documents` row whose FK needs the seeded GLOBAL tenant. Folding `db:seed` into the harness makes the suite self-contained.
- Did not flip any Task Manifest `[ ]` → `[x]`: M11.1's remaining leg (Playwright E2E + load smoke against running services) is still sandbox-blocked, and the other open items are human sign-off gates.

**Files changed:**
- `infra/local-test-db.sh` — new Docker-based live-DB integration runner.
- `package.json` — root `test:integration` script → the harness.
- `infra/README.md` — documented the harness under the test-gate section.
- `project-mds/progress-state.md` — recorded the executed-green live-DB tier + refined the M11.1 next-task framing (DB tier now covered; only the browser/emulator stack remains blocked).

**Tests:** default suite unchanged (1033 pass / 0 fail; FULL TURBO cached). Live-DB tier now executes: 15 (db) + 35 (api) = **50 live tests pass**. typecheck/lint/deadcode/build all green.

## M11.1 enabler fix — API Firebase Admin init is emulator-aware (E2E stack can boot)
**Date:** 2026-06-02
**Ref:** PRD §"Testing Strategy" (M11.1); LEARNINGS #9

**What was done:**
- Found a boot-time bug that blocked the *entire* Playwright E2E stack from ever starting: the M11.1 enabler added env-guarded `connectAuthEmulator` wiring to the web + admin Firebase clients and the Playwright `webServer` passes `FIREBASE_AUTH_EMULATOR_HOST` to the API process — but the API's `createFirebaseApp` (Admin SDK) always required a full service-account cert (`projectId`+`clientEmail`+`privateKey`) and threw `Firebase credentials missing` otherwise. So `pnpm --filter @expertos/api start` under the emulator throws on boot, `/health` never comes up, and Playwright aborts before any spec runs.
- Made `createFirebaseApp` emulator-aware: when `FIREBASE_AUTH_EMULATOR_HOST` is set it initializes with just a `projectId` (from `FIREBASE_PROJECT_ID`/`GCLOUD_PROJECT`, placeholder `demo-expertos` fallback) and no cert — the Admin SDK skips signature verification against the emulator. Mirrors the client env-guard; production no-op (prod never sets that var).
- Passed `FIREBASE_PROJECT_ID: env.firebaseProjectId` to the Playwright `api` webServer so the Admin SDK validates emulator-minted tokens under the same project the clients use.
- Added 4 unit tests for `createFirebaseApp` (reuse-existing-app, cert/prod path with `\n` unescape, emulator path, emulator placeholder-projectId fallback) using a `firebase-admin/app` module mock so init decisions are observable without touching the process-global app registry.
- Fixed a stale `e2e/README.md` line (account-billing checkout was marked "no consumer CTA yet" — M6.2 since built the CTA; only the external Stripe-hosted page stays a fixme) and documented that the API needs no service-account cert in emulator mode.
- Added LEARNINGS #9 (two-sided emulator enabler must be wired on every process; Admin SDK has a different init contract than the client SDK).

**Key decisions:**
- Mocked `firebase-admin/app` in the test rather than calling the real `initializeApp` so the test never mutates the global Firebase app registry (which would make the order-dependent throw-when-missing test flaky). Reset `getApps` per test.
- Placeholder project id `demo-expertos` only when nothing is configured — keeps a bare `node load/smoke.mjs`-style emulator boot working, while real E2E always passes the explicit project.
- Did not add a directive: this is environment/test-enablement specific, not an every-change rule.

**Files changed:**
- `apps/api/src/auth/firebase-admin.provider.ts` — emulator branch in `createFirebaseApp` (init with `projectId` only, no cert, when `FIREBASE_AUTH_EMULATOR_HOST` set).
- `apps/api/src/auth/firebase-token-verifier.test.ts` — +4 `createFirebaseApp` tests via a `firebase-admin/app` mock.
- `e2e/playwright.config.ts` — api webServer now also passes `FIREBASE_PROJECT_ID`.
- `e2e/README.md` — corrected stale checkout-fixme line; documented cert-free emulator init.
- `project-mds/LEARNINGS.MD` — added #9.

**Notes for next iteration:**
- The API will now boot under the Auth emulator, but full M11.1 execution is still blocked in-sandbox on chromium Linux system-deps + a `firebase-tools` emulator + the 3 running services. npm registry is reachable (verified), so a future run could attempt `playwright install chromium` + `firebase-tools` if system deps/network for the browser CDN + emulator jar are granted.
- M11.3 `load/smoke.mjs` still awaits the running services; the API boot path is now one blocker lighter.

---

## M11.1 — Playwright E2E suite executed green against a live stack

**What:** Stood up the full live stack in-sandbox and ran the opt-in Playwright E2E suite end to end for the first time. Result: **15 passed / 4 skipped / 0 failed** (the 4 skips are the 3 documented `test.fixme` legs + the expert-voice test, which `test.skip`s cleanly when no published voice is seeded). Flipped M11.1 `[~] → [x]`.

**Stack brought up (all in-sandbox, no GCP):**
- DB: `infra/local-test-db.sh up` (pgvector in Docker, migrate + seed, `app_user` LOGIN).
- Auth: `firebase-tools` Auth emulator on `:9099` (project `expertos-e2e`); the emulator JAR downloads through the firewall.
- Services: `pnpm build` then `node dist/main.js` (api, emulator-aware Firebase init) + `next start` (web :3000, admin :3002), all built with the E2E `NEXT_PUBLIC_*` baked in (NEXT_PUBLIC is inlined at **build** time, not start time).
- Browser: chromium binary was cached but needed `apt-get install` of its system libs **and** base fonts (`fonts-liberation`) — without fonts headless chromium lays out text at 0 height and visibility assertions on bare headings fail (LEARNINGS #11).

**New code — make the suite repeatable:**
- `e2e/global-setup.ts` (+ `globalSetup` in `playwright.config.ts`, + `@expertos/db` devDep, + knip entry): signs all 4 identities into the emulator + `GET /me` to mirror their rows, then promotes `e2e-admin@`→admin / `e2e-expert@`→expert and puts `e2e-member@` on **Plus** directly in the DB (reads `DATABASE_URL`, via the app's own `applyRlsContext` admin context). Plus (not top tier) keeps the account-billing upgrade CTA visible while lifting the Free 10/mo hard cap and enabling document upload.
- Programmatic emulator sign-in: each app's `lib/firebase.ts` now exposes an emulator-gated `window.__e2eSignIn` (email/password against the emulator on the app's own Auth instance); `fixtures/auth.ts` drives it instead of the Google popup. `signInWithPopup` loads `apis.google.com` (firewall-blocked offline) → `auth/internal-error`; the programmatic path needs no external network. Gated on `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (never set in prod).

**Real bugs found + fixed (not just test wiring):**
- **API had no CORS** (`apps/api/src/main.ts`): web/admin are separate origins from the API, so the first browser cross-origin `fetch` (chat stream) failed its preflight (`Cannot OPTIONS /chat → 404`) and hung forever. Added `enableCors` with a `CORS_ORIGINS` allowlist (default local web/admin) + `Authorization`/`Content-Type` headers; bearer auth so no credentials. LEARNINGS #10 + DIRECTIVE #39.
- **Admin `<Field label="Status">` had no `htmlFor`** (`apps/admin/app/knowledge/page.tsx`): the DS `Field` renders the `<label>` separately, so the select was programmatically unlabeled — `getByLabel`/screen readers couldn't resolve it. Added `htmlFor`/`id`. LEARNINGS #12 + DIRECTIVE #38.

**Harness/spec selector fixes (latent — the specs had never run):**
- `ask()` waited on the Send button re-enabling, which never happens (the input is cleared so it stays disabled) → wait on the "Was this helpful?" affordance instead.
- Loose `getByText("Saved"/"persistent")` matched hidden `<option>`/help text → `{ exact: true }`.
- `.or(a, b)` of two present elements tripped strict mode → `.first()` (out-of-domain, account-billing).
- `getByRole("link"/"button", { name })` substring collisions → `exact: true` (Knowledge/Users nav, history Rename action vs conversation titles).
- Status filter selected by humanized label "Published" (actual option text is lowercase "published") → select by option value.
- data-deletion clicked the email `<td>` (not clickable) → click the row's "Manage" link.

**Remaining (all by design):** 3 `test.fixme` legs (publish→retrieval round-trip + irreversible deletion cascade need a seed; Stripe-hosted checkout is an external surface) + the expert-voice test (needs a seeded published voice profile to un-skip).

**Gates:** typecheck ✅, test ✅ (1037, coverage gate met), lint ✅ (incl. e2e + stylelint), deadcode ✅, build ✅. E2E run: 15/0/4.

## M11.1: seed a published expert voice → un-skip the voice E2E leg
**Date:** 2026-06-02
**Ref:** PRD Task Manifest M11.1 ("Un-skipping the expert-voice test needs a seeded published voice profile")

**What was done:**
- Added idempotent expert-voice seeding to `e2e/global-setup.ts` (inside the existing admin-context transaction, after the member→Plus block): upsert one active `Expert` (slug `e2e-expert`, displayName "Dr. Ada Mentor", linked to the e2e-expert@ identity) + create a published `en` `VoiceProfile` if none exists (approvedBy = e2e-admin@, approvedAt = now).
- This makes the M2.2 voice picker offer a non-neutral option and lets the chat voice layer resolve a profile, so the `web-voice-and-consultation` "selecting an expert voice renders an AI-rendition attribution" test (which was `test.skip(!expert, ...)` by design) now runs instead of skipping. No test-file change — the test was authored to run-when-present.
- Validated the seed CRUD + both query paths against a live pgvector DB (`infra/local-test-db.sh up`): a throwaway `tsx` script replayed the exact seed block under RLS, then ran the real `PgExpertStore.listExperts` and `PgVoiceExampleStore.loadProfile` SQL — both returned the seeded "Dr. Ada Mentor". Re-ran to confirm idempotency (same IDs, still exactly one expert/profile). Script + container removed after.

**Key decisions:**
- **Seed in `global-setup.ts`, not `packages/db/prisma/seed.ts`.** The db seed is consumed by the live-DB integration harness (50 api/RLS tests); adding an expert there risks perturbing suites that assert empty-expert/no-voice states. global-setup is E2E-only with the smallest blast radius and is already the documented out-of-band stack prep.
- **No embedded `VoiceExample` rows.** The rendition badge only needs a resolved published profile (expertName); voice examples require the embedding pipeline and aren't needed for the test. Seeded `guidelines` text so the voice still has substance for the prompt builder.
- Linked the Expert to the e2e-expert@ user so the expert-portal E2E flows also see a real expert.

**Files changed:**
- `e2e/global-setup.ts` — +42 lines: idempotent active-expert + published-en-voice-profile seed inside the global-setup transaction.

**Notes for next iteration:**
- Couldn't execute the full Playwright run here (chromium needs system-deps + fonts + the emulator stack), but the seed's DB-write + both consuming SQL paths are verified against a real schema, and the test guard (`test.skip(!expert)`) flips deterministically once the picker has a non-neutral option. Expected E2E delta: 15→16 pass, 4→3 skip.
- Remaining M11.1 fixme legs are still external/seed-gated: publish→retrieval round-trip (needs a Draft doc seed), deletion cascade (throwaway user), Stripe-hosted checkout (external surface).

**Gates:** typecheck ✅, test ✅ (1037, unchanged — e2e excluded from default test), lint ✅ (incl. e2e + stylelint), deadcode ✅, build ✅ (7/7).

---

## M12.1.1 — `.chat-layout` three-pane grid CSS (+ pre-existing lint-gate remediation)
**Date:** 2026-06-02
**Ref:** PRD §"M12 — Frontend UI Overhaul" / `requirements/ui-reference-spec.md` §"Layout: Three-Pane Studio"

**What was done:**
- Added `.chat-layout` to `packages/ui/src/ds.css`: a viewport-height CSS grid with named areas (`sidebar`/`main`/`rail`) at `248px minmax(0,1fr) 320px`, plus child hooks `.chat-sidebar` / `.chat-main` / `.chat-rail`. Responsive per the spec: `@media (width < 1280px)` drops the sources rail (re-lists the template to `sidebar main`), `@media (width < 900px)` drops the sidebar too (`main` only). Range-notation media queries (stylelint-standard requires it).
- Fixed the **pre-existing red lint gate** the M12.8 login commit (`1d228a3`) left on `main` — `pnpm lint` was failing but went unnoticed because turbo (which runs the per-workspace eslint half) SIGILLs in this sandbox, so only `lint:css` actually ran:
  - `apps/web/app/login.css` used raw `px` for every dimension (34 stylelint errors). Converted to ds.css spacing tokens where they hit the 4px grid and rem otherwise (root font-size is 15px, so `1rem = 15px` — pixel-faithful + a11y-scalable). Media breakpoint → `@media (width < 60rem)`. The Google button now reuses `.btn .btn-ghost` (border/radius/hover) with a bespoke padding override so it keeps its ≥44px hit target.
  - The Google "G" `<svg>` brand-hex fills in `apps/web/app/page.tsx` and `apps/admin/src/components/AdminFrame.tsx` tripped the eslint `no-restricted-syntax` hardcoded-hex guard. Wrapped each `GoogleIcon` in a scoped `/* eslint-disable no-restricted-syntax -- third-party brand logo */ … /* eslint-enable */` (brand colors are mandated, not theme tokens). `page.tsx` button className updated to `btn btn-ghost btn-google`.

**Key decisions:**
- ds.css is the correct home for `.chat-layout` (it's the shared visual source-of-truth, exempt from the px/hex guards). Used named grid-areas (not column-only) so each breakpoint drops a column by re-listing the template without re-parenting children — cleaner than `display:none` alone and keeps M12.1.2's `ChatLayout` markup stable.
- Remediated the login lint break rather than committing on a red gate (directive step 5). Chose rem-over-15px-root for bespoke sizes (pixel-faithful, zero visual change) instead of snapping everything to the 4px token scale (would have shifted the approved mockup). Reused `.btn-ghost` to avoid a raw `border:1px` while preserving the hit target via a padding override.

**Files changed:**
- `packages/ui/src/ds.css` — new `.chat-layout` section (grid + child hooks + two responsive breakpoints).
- `apps/web/app/login.css` — rewrote dimensions as ds.css tokens + rem; button reuses `.btn .btn-ghost`.
- `apps/web/app/page.tsx` — button className → `btn btn-ghost btn-google`; scoped eslint-disable around `GoogleIcon`.
- `apps/admin/src/components/AdminFrame.tsx` — scoped eslint-disable around `GoogleIcon`.
- `project-mds/LEARNINGS.MD` — added #13 (app-CSS px ban → rem/tokens; brand-hex disable; turbo-SIGILL hides the lint half).
- `project-mds/PRD.md`, `progress-state.md` — manifest + state.

**Notes for next iteration:**
- `turbo` arm64 binary SIGILLs here — run gates per-workspace directly (`tsc --noEmit`, `next lint --max-warnings 0`, `jest`). Verified: web tsc ✅, admin tsc ✅, ui jest 29 ✅, css/web/admin lint ✅, knip ✅. web/admin have no unit tests (`--passWithNoTests`); shared/db/ai/api untouched.
- `.chat-layout` is CSS only — no consumer yet. M12.1.2 extracts the `ChatLayout` React component and wires it into `/chat` (currently a single `.card`). The current chat page still uses the old single-card layout.
- Coverage gap noted in LEARNINGS #13: `apps/admin/src/components/admin-login.css` is outside the `apps/**/app/**` lint:css glob, so it isn't stylelinted. Widen the glob if admin CSS grows.

## M12.1.2 — Extract `ChatLayout` component + integrate into `/chat`
**Date:** 2026-06-02
**Ref:** PRD §"M12 — Frontend UI Overhaul" task M12.1.2; `requirements/ui-reference-spec.md` §"Layout: Three-Pane Studio"

**What was done:**
- New `packages/ui/src/ChatLayout.tsx` — a `ChatLayout` component that renders the M12.1.1 `.chat-layout` grid, mapping optional `sidebar`/`rail` props into `.chat-sidebar`/`.chat-rail` and `children` into `.chat-main`. Follows the existing `Shell` component pattern (omitted panes short-circuit to `false` so the classic/focus layout directions can drop a pane by passing `undefined`).
- Exported `ChatLayout` + `ChatLayoutProps` from `packages/ui/src/index.ts`; rebuilt `packages/ui/dist` so the web app's `@expertos/ui` import resolves the new export.
- Integrated into `apps/web/app/chat/page.tsx`: the signed-out and signed-in renders now wrap their `<main>` in `<ChatLayout>` instead of standing alone. Re-indented the signed-in JSX subtree to match the new nesting.
- Added `.chat-main > .chat-content` to `ds.css` (`flex:1; min-height:0; overflow-y:auto`) so the chat column scrolls within the 100vh `.chat-main` flex column — sets up the future sticky input bar (M12.6).
- Tests: 3 new `ChatLayout` cases in `packages/ui/src/primitives.test.ts` (bare main-only, full sidebar+rail, className merge); 100% coverage on `ChatLayout.tsx`.

**Key decisions:**
- Kept scope to the *shell only* — sidebar (M12.2), topbar (M12.3), messages (M12.4), sources rail (M12.5), input bar (M12.6) are their own tasks. The existing chat content moves verbatim into `.chat-main`; no sidebar/rail content yet (single-column ChatLayout is valid and shippable).
- Mirrored `Shell`'s "render-region-only-when-given" idiom rather than always emitting empty `<aside>`s, so M12.1.3's layout directions get a clean knob (pass `undefined` to drop a pane).
- Added `.chat-content` (not in the spec's class list) as legitimate scroll infrastructure for the 100vh column; uses only tokens/keywords (no hardcoded px/hex).

**Files changed:**
- `packages/ui/src/ChatLayout.tsx` — NEW component.
- `packages/ui/src/index.ts` — export `ChatLayout` + `ChatLayoutProps`.
- `packages/ui/src/primitives.test.ts` — +3 ChatLayout tests.
- `packages/ui/src/ds.css` — `.chat-main > .chat-content` scroll region.
- `apps/web/app/chat/page.tsx` — wrap both renders in `ChatLayout`; main column gets `.chat-content`.

**Notes for next iteration:**
- Gates run per-workspace (turbo SIGILLs here): ui tsc ✅, ui jest 32 ✅ (ChatLayout 100%), ui eslint+stylelint ✅, web tsc ✅, web next lint ✅, knip ✅. Had to rebuild `packages/ui/dist` for the web tsc to see the new export — remember this when adding ui exports consumed cross-workspace.
- Next: M12.1.3 (layout-direction switcher: classic/studio/focus) — `ChatLayout` already supports dropping panes via `undefined` props; the switcher just chooses which props to pass + persists choice. Then M12.2 builds real sidebar content to pass as the `sidebar` prop.

## M12.1.3 — Layout direction switcher state (classic / studio / focus)
**Date:** 2026-06-02
**Ref:** PRD §M12 (Frontend UI Overhaul); `requirements/ui-reference-spec.md` ("Three layout directions")

**What was done:**
- New `packages/ui/src/layout.ts` — the presentational "switcher state" abstraction:
  - `LayoutDirection` = `classic | studio | focus`; `LAYOUT_DIRECTIONS` (in `.seg` order), `DEFAULT_LAYOUT_DIRECTION` = studio.
  - `LAYOUT_DIRECTION_INFO` — label + one-line description per direction (M12.7.2 `.seg` copy).
  - `layoutPanes(direction)` — pure map to `{ sidebar, rail }` persistent-grid panes (studio = both, classic = sidebar only, focus = neither).
  - `isLayoutDirection(value)` — type guard for restoring a persisted value (M12.7.2 localStorage).
- `ChatLayout` gains an optional `direction` prop (default studio): consumes `layoutPanes` so a dropped pane is suppressed from the grid even when content is supplied, and emits a `chat-layout-{direction}` modifier class.
- `packages/ui/src/ds.css` — `.chat-layout.chat-layout-classic` (drop rail → 2-col) and `.chat-layout.chat-layout-focus` (drop sidebar+rail → 1-col) grid reflow; doubled-class selector outranks the base breakpoint rules at full width, and a `<900px` block collapses classic's sidebar too. Studio keeps the existing base + breakpoints.
- `apps/web/app/chat/page.tsx` — page now owns a `direction` state (default studio) passed to both `ChatLayout` renders; the toggling control + localStorage persistence is M12.7.2.
- Tests: `primitives.test.ts` +6 (ChatLayout classic/focus pane-dropping, modifier class; layout helpers) — ui 32 → 38, layout.ts + ChatLayout.tsx 100% coverage. Rebuilt `packages/ui/dist` (web/admin resolve the package from `dist`).

**Key decisions:**
- Kept the state **pure and prop-driven** (presentational `ChatLayout` + `layoutPanes` helper; page owns the value) rather than a `useLayoutDirection` hook. The ui/web test envs are node-only with no jsdom/testing-library, so a hook using `localStorage`/React state isn't unit-testable in the existing pure-function style; a pure helper keeps the 90% coverage gate green. M12.7.2 layers the segmented control + localStorage on top.
- Dropped panes' content is handed off (not destroyed): in classic/focus the rail/sidebar still reopen as drawers/overlays in M12.5.4 / M12.9.1. `ChatLayout` suppresses them from the *grid* only.
- Used the doubled `.chat-layout.chat-layout-*` selector (specificity 0,2,0) so direction wins over the base breakpoint rules at desktop width while narrower widths still collapse further — predictable without fighting source order.

**Files changed:**
- `packages/ui/src/layout.ts` — new: direction type, constants, `layoutPanes`, `isLayoutDirection`, info map.
- `packages/ui/src/ChatLayout.tsx` — `direction` prop + per-direction pane dropping + modifier class.
- `packages/ui/src/ds.css` — classic/focus grid-reflow rules (+ <900px classic collapse).
- `packages/ui/src/index.ts` — export the layout module.
- `packages/ui/src/primitives.test.ts` — +6 tests (direction-aware ChatLayout + layout helpers).
- `apps/web/app/chat/page.tsx` — page-owned `direction` state passed to `ChatLayout`.

---

## M12.2.1 — Chat sidebar shell (ChatSidebar component)

**Ref:** PRD §M12 (Frontend UI Overhaul); `requirements/ui-reference-spec.md` ("1. Sidebar (Left Panel)")

**What was done:**
- New `packages/ui/src/ChatSidebar.tsx` — the dark ds.css `.side` rail that fills the `.chat-layout` sidebar pane (M12.1):
  - ExpertOS wordmark in a reused `.brand` row (white `.expert` + crimson `.os`, white-on-dark via the existing `.side .brand .logo .expert` rule).
  - Optional collapse button (`onClose?`) — inline SVG X with `aria-label="Collapse sidebar"`, rendered only when a caller supplies `onClose`.
  - Full-width crimson "+ New conversation" `.btn-primary` (`.chat-side-new` → `width:100%`).
  - `children` → `.chat-side-body` slot (search M12.2.2 + list M12.2.3) and `footer` → `.chat-side-foot` slot (usage meter M12.2.4); both collapse when unused.
- `packages/ui/src/ds.css` — new `.chat-side*` block: `.chat-side-collapse` (36px transparent dark icon button, `rgba(255,255,255,.08)` hover matching the existing `.side .navitem` pattern), `.chat-side-new` full-width, `.chat-side-body` (flex:1, scroll column) + `.chat-side-foot` (margin-top:auto pin).
- `apps/web/app/chat/page.tsx` — `startNewConversation` callback (clears messages/conversationId/draft/error, no-op while busy); `<ChatSidebar onNewConversation={…}>` passed to the signed-in `ChatLayout` `sidebar` prop (studio default shows it).
- Tests: `primitives.test.ts` +4 (rail class + wordmark + full-width primary; collapse only with onClose; body/footer slot mounting; className merge) — ui 38 → 42; `ChatSidebar.tsx` 100% coverage. Rebuilt `packages/ui/dist` (web resolves the package from `dist`).

**Key decisions:**
- `onClose` is **opt-in** and NOT wired from the chat page yet: the collapse control only has a re-open affordance once Tweaks (M12.7) / the responsive overlay (M12.9.1) land, so passing it now would create a dead-end control. The component fully supports it; the page opts in later.
- Reused the dark `.side` + `.brand` rather than inventing chat-only header classes — keeps the white-wordmark rule and dark-rail styling single-sourced with the admin/expert portals.
- Body/footer slots added now (like ChatLayout's sidebar/rail slots in M12.1.2) so M12.2.2–4 mount content without reworking the signature.
- SVG icon sized via width/height attributes (the AdminFrame GoogleIcon pattern) since a bare `.ic` class has no ds.css size rule.

**Files changed:**
- `packages/ui/src/ChatSidebar.tsx` — new presentational sidebar shell.
- `packages/ui/src/ds.css` — `.chat-side*` styling.
- `packages/ui/src/index.ts` — export `ChatSidebar` + props.
- `packages/ui/src/primitives.test.ts` — +4 tests.
- `apps/web/app/chat/page.tsx` — `startNewConversation` + sidebar wiring.
