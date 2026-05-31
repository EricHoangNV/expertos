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
