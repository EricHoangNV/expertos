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
