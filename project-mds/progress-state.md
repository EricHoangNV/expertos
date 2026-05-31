# Progress

## Current State
- Completed:
  - **P0.1** — git init + pnpm + Turborepo monorepo scaffold (apps/web, apps/admin, apps/api, packages/shared, packages/db, packages/ai, packages/ui, infra/). All feedback loops green.
  - **P0.2** — Postgres + pgvector via Prisma; tenant-ready schema + RLS migration (§"Data Model"). Full multi-tenant schema (36 models), pgvector `vector(1536)` embedding columns + HNSW cosine indexes, two migrations (`init_schema`, `rls_and_vector_index`), idempotent seed (GLOBAL tenant + plans/prices + entitlement catalog + plan×feature matrix), and `applyRlsContext` helper. RLS verified end-to-end through Prisma as the non-superuser `app_user` (deny-by-default, tenant+user isolation, cross-tenant write blocked, global knowledge cross-tenant readable, admin bypass).
- Tests: 21 pass / 0 fail / 0 skip (shared 4, ui 3, db 9, ai 5, api 1 — across 6 suites). db = config 4 + rls 5, 100% coverage.
- Build: passing — `pnpm build` (turbo) builds all 7 workspaces.
- Gates: typecheck ✅, test ✅ (coverage gate met), lint ✅, deadcode (knip) ✅
- Next tasks (from PRD.md Task Manifest, Phase 0):
  1. P0.3 — Firebase Auth wiring + RBAC roles (packages/shared exposes `roles.ts`; `@expertos/db` now exposes `prisma`, `applyRlsContext`, `GLOBAL_TENANT_ID` for the auth guard to set per-request RLS context)
  2. P0.4 — Manual build & deploy scripts + minimal scale-to-zero Terraform (infra/ has main.tf/variables.tf stubs)
  3. P0.5 — Observability baseline (`usage_logs` table + cost columns already in schema)
  4. P0.6 — Design system foundation + Stylelint/ESLint guard (note: ds.css currently fails the existing .stylelintrc.json — the guard wiring + cleanup is P0.6's job)
  5. In parallel: resolve Phase-0 Open Decisions (#1, #2, #3, #4, #6)

## Notes for next agent
- **DB engine quirk (this sandbox only):** Prisma's default **library** query engine SIGILLs (exit 132) at runtime on this aarch64/linuxkit box. The schema/migration engine is fine (`prisma migrate deploy` works). To run anything through Prisma **Client** locally (seed, scripts), prefix with `PRISMA_CLIENT_ENGINE_TYPE=binary`. The committed schema intentionally keeps the **default library engine** (correct for prod amd64 Cloud Run) — do NOT pin `engineType=binary` in schema.prisma. See LEARNINGS #1.
- **Running migrations locally:** `prisma migrate dev` / `--create-only` are interactive and fail in this non-interactive shell. Generate SQL with `prisma migrate diff --from-empty --to-schema-datamodel ... --script` into a `prisma/migrations/<ts>_<name>/migration.sql` dir (+ `migration_lock.toml`), then `prisma migrate deploy`.
- **P0.3 RLS wiring:** the API auth guard must (a) connect Prisma as the non-superuser `app_user` role (so RLS enforces), and (b) wrap each request's DB work in `prisma.$transaction(tx => { await applyRlsContext(tx, {tenantId, userId, isAdmin}); ... })`. `applyRlsContext` uses `SET LOCAL`-equivalent `set_config(..., true)`, so it ONLY scopes inside a transaction. `app_user` is created NOLOGIN by the migration — production must provision LOGIN + password out of band (e.g. Secret Manager).
- pgvector embedding columns are `Unsupported("vector(1536)")` — Prisma Client can't read/write them; the M1 VectorStore driver must use `$queryRaw`. Dimension 1536 = OpenAI text-embedding-3-small; changing the model = new migration.
- `prisma generate` runs in db's `postinstall`, `build`, and `typecheck` so the gitignored `generated/client` always exists for downstream typecheck/build/knip.
- Stylelint is configured but NOT wired into lint; ds.css fails it. That cleanup is P0.6.
- `@expertos/shared` still unused by apps; re-add the workspace dep when first imported (P0.3 likely).
- `@nestjs/testing`/`@nestjs/schematics` removed from apps/api; re-add `@nestjs/testing` (+ knip ignore) when the first NestJS module test is written.
