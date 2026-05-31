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
