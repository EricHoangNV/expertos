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
