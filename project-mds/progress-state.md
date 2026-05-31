# Progress

## Current State
- Completed:
  - **P0.1** — git init + pnpm + Turborepo monorepo scaffold (apps/web, apps/admin, apps/api, packages/shared, packages/db, packages/ai, packages/ui, infra/). All feedback loops green.
  - **P0.2** — Postgres + pgvector via Prisma; tenant-ready schema + RLS migration (§"Data Model"). Full multi-tenant schema (36 models), pgvector `vector(1536)` embedding columns + HNSW cosine indexes, two migrations (`init_schema`, `rls_and_vector_index`), idempotent seed, and `applyRlsContext` helper. RLS verified end-to-end through Prisma as the non-superuser `app_user`.
  - **P0.3** — Firebase Auth wiring + RBAC roles (§"Security"). API: `auth/` module — `TokenVerifier` abstraction + `FirebaseTokenVerifier` (Firebase Admin SDK), global `FirebaseAuthGuard` (verify token → find-or-create user under admin/system RLS context → attach `req.authUser`), `RolesGuard` + `@Roles()` (hierarchical via `satisfiesRole`), `@Public()`, `@CurrentUser()`, `RlsService.run()` (per-request transaction + `applyRlsContext`), `MeController` (`GET /me`, `GET /me/admin` role-gated). `DatabaseModule` provides the `PRISMA` token. Health route marked `@Public()`. Web: lazy Firebase client (`getFirebaseAuth`), `AuthProvider`/`useAuth` (Google sign-in via popup, `getIdToken`), sign-in/out on home page.
- Tests: 42 pass / 0 fail / 0 skip (shared 4, ui 3, db 9, ai 5, api 21 — across 11 suites). api = health 1 + auth.service 3 + rls.service 2 + firebase-auth.guard 8 + roles.guard 4 + firebase-token-verifier 3; services 100% coverage.
- Build: passing — `pnpm build` (turbo) builds all 7 workspaces.
- Gates: typecheck ✅, test ✅ (coverage gate met), lint ✅, build ✅, deadcode (knip) ✅
- Next tasks (from PRD.md Task Manifest, Phase 0):
  1. P0.4 — Manual build & deploy scripts (`gcloud run deploy`, coverage-gated `test`) + minimal scale-to-zero Terraform (infra/ has main.tf/variables.tf stubs)
  2. P0.5 — Observability baseline: structured logging, Sentry, request tracing, cost/usage logging (`usage_logs` table + cost columns already in schema)
  3. P0.6 — Design system foundation + Stylelint/ESLint guard (note: ds.css currently fails the existing .stylelintrc.json — the guard wiring + cleanup is P0.6's job)
  4. In parallel: resolve Phase-0 Open Decisions (#1, #2, #3, #4, #6)

## Notes for next agent
- **DB engine quirk (this sandbox only):** Prisma's default **library** query engine SIGILLs (exit 132) at runtime on this aarch64/linuxkit box. The schema/migration engine is fine (`prisma migrate deploy` works). To run anything through Prisma **Client** locally (seed, scripts), prefix with `PRISMA_CLIENT_ENGINE_TYPE=binary`. The committed schema intentionally keeps the **default library engine** (correct for prod amd64 Cloud Run) — do NOT pin `engineType=binary` in schema.prisma. See LEARNINGS #1.
- **Running migrations locally:** `prisma migrate dev` / `--create-only` are interactive and fail in this non-interactive shell. Generate SQL with `prisma migrate diff --from-empty --to-schema-datamodel ... --script` into a `prisma/migrations/<ts>_<name>/migration.sql` dir (+ `migration_lock.toml`), then `prisma migrate deploy`.
- **Auth flow (P0.3):** `FirebaseAuthGuard` resolves the user via `AuthService.resolveUser`, which find-or-creates the `users` row inside an **admin/system RLS context** (`isAdmin:true`, GLOBAL tenant) — necessary because `users` is RLS-protected and the tenant isn't known until after lookup, and `firebase_uid` is globally unique. After resolution, real request DB work should run inside `RlsService.run(authUser, tx => …)` (scopes by the user's tenant/user; `is_admin` GUC = true for the `admin` role so the admin/expert portals get cross-tenant visibility). No data endpoints consume `RlsService` yet (only `/me`, which echoes the already-resolved user) — wire it into the first real CRUD route.
- **Prod DB role:** `DATABASE_URL` must point to the non-superuser `app_user` (LOGIN + password provisioned out of band via Secret Manager) so RLS enforces. The committed `.env.example` uses the owner role for local dev convenience — acceptable locally, NOT for prod.
- **Firebase init is lazy on the web** (LEARNINGS #3): module-level `getAuth()` breaks `next build`. Use `getFirebaseAuth()` from effects/handlers only; `isFirebaseConfigured` gates the auth subscription. Set `NEXT_PUBLIC_FIREBASE_*` (web) + `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` (API) to actually sign in.
- pgvector embedding columns are `Unsupported("vector(1536)")` — Prisma Client can't read/write them; the M1 VectorStore driver must use `$queryRaw`. Dimension 1536 = OpenAI text-embedding-3-small; changing the model = new migration.
- `prisma generate` runs in db's `postinstall`, `build`, and `typecheck` so the gitignored `generated/client` always exists for downstream typecheck/build/knip.
- Stylelint is configured but NOT wired into lint; ds.css fails it. That cleanup is P0.6.
- `@nestjs/testing`/`@nestjs/schematics` removed from apps/api; re-add `@nestjs/testing` (+ knip ignore) when the first NestJS module-level (DI container) test is written. Current auth tests construct services/guards directly (no Nest test harness needed).
