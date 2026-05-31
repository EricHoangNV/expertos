# Progress

## Current State
- Completed:
  - **P0.1** — git init + pnpm + Turborepo monorepo scaffold (apps/web, apps/admin, apps/api, packages/shared, packages/db, packages/ai, packages/ui, infra/). All feedback loops green.
- Tests: 16 pass / 0 fail / 0 skip (shared 4, ui 3, db 4, ai 5, api 1 — across 5 suites)
- Build: passing — `pnpm build` (turbo) builds all 7 workspaces (Next.js web/admin, NestJS api, tsc libs)
- Gates: typecheck ✅, test ✅ (coverage gate met), lint ✅, deadcode (knip) ✅
- Next tasks (from PRD.md Task Manifest, Phase 0):
  1. P0.2 — Postgres + pgvector via Prisma; tenant-ready schema + RLS migration (§"Data Model")
  2. P0.3 — Firebase Auth wiring + RBAC roles (packages/shared already exposes `roles.ts`)
  3. P0.4 — Manual build & deploy scripts + minimal scale-to-zero Terraform (infra/ has main.tf/variables.tf stubs)
  4. P0.5 — Observability baseline
  5. P0.6 — Design system foundation + Stylelint/ESLint guard (note: ds.css currently fails the existing .stylelintrc.json — the guard wiring + cleanup is P0.6's job)
  6. In parallel: resolve Phase-0 Open Decisions (#1, #2, #3, #4, #6)

## Notes for next agent
- Stylelint is configured (`.stylelintrc.json`) but NOT wired into any pnpm script or turbo `lint`. `packages/ui/src/ds.css` currently reports stylelint errors. Wiring the design-system guard and fixing ds.css is P0.6 — do it there, not piecemeal.
- `@expertos/shared` was declared as a dependency of web/admin/api/ai but unused; removed to satisfy knip. Re-add `"@expertos/shared": "workspace:*"` to a package's package.json the moment it actually imports from it (e.g. P0.3 RBAC will likely re-add it to apps/api).
- `@nestjs/testing` / `@nestjs/schematics` were removed from apps/api (unused; schematics is provided transitively by @nestjs/cli). Re-add `@nestjs/testing` (and add it to knip `ignoreDependencies`, since knip ignores *.test.ts) when the first NestJS module/controller test is written.
