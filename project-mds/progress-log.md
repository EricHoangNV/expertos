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
