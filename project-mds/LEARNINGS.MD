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
- Do **not** pin `engineType = "binary"` in `schema.prisma`: production runs on amd64 Cloud Run where the library engine is correct and preferred. This is an environment quirk, not a code defect — keep the committed default.
- Related: `prisma migrate dev` / `migrate dev --create-only` are interactive and abort in a non-interactive shell. Author migrations with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` → write to `prisma/migrations/<ts>_<name>/migration.sql` (+ `migration_lock.toml`) → `prisma migrate deploy`.

**Rule:** When Prisma Client SIGILLs locally, run it with `PRISMA_CLIENT_ENGINE_TYPE=binary` rather than changing the committed engine type, and build migrations via `migrate diff` + `migrate deploy` in non-interactive environments.

---

## 3. Firebase client SDK must be lazily initialized in Next.js (App Router) or `next build` fails

**Context:** P0.3 (Firebase Auth wiring) — `pnpm build` failed prerendering `/` with `FirebaseError: auth/invalid-api-key`.

- `next build` statically prerenders pages **on the server**, including client components and anything imported by the root `layout.tsx`. If a module called at import-time runs `getAuth(initializeApp(config))` with empty `NEXT_PUBLIC_*` config (the normal state in CI / unconfigured dev), Firebase throws `auth/invalid-api-key` during prerender and the whole build fails — even for unrelated routes like `/_not-found`, because they share the root layout's import chain.
- Fix: never call `getAuth`/`initializeApp` at module top level. Wrap it in a lazy `getFirebaseAuth()` that initializes on first call, and only call it from **client-runtime** code paths (effects, event handlers) — never during render. React effects don't run during SSR/prerender, so the build stays credential-free. Also gate the auth subscription on an `isFirebaseConfigured` flag (`Boolean(apiKey)`) so unconfigured dev resolves to a clean signed-out state instead of crashing on mount.
- Unrelated but observed same session: a previous failed Next build can leave a corrupted `.next` cache → `SyntaxError: Unexpected end of JSON input` reading a manifest on the next build. `rm -rf apps/*/.next` and rebuild.

**Rule:** In Next.js App Router, defer all Firebase client initialization to a lazy getter invoked only from client-runtime code (effects/handlers), and guard it behind a config-present check — module-level `getAuth()` breaks `next build` prerendering.
