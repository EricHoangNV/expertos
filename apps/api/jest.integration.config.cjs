const base = require("../../jest.base.cjs");

// Opt-in live-database integration suite (M11 — the deferred raw-SQL "Testcontainers"
// pass for the M1.2 retrieval driver). Run with a real Postgres reachable as the
// non-superuser `app_user` role. The Prisma library engine SIGILLs on this
// aarch64/linuxkit sandbox, so regenerate the client with the binary engine first:
//
//   PRISMA_CLIENT_ENGINE_TYPE=binary pnpm --filter @expertos/db exec prisma generate
//   PRISMA_CLIENT_ENGINE_TYPE=binary \
//     RLS_TEST_DATABASE_URL="postgresql://app_user:app_user@localhost:5432/expertos?schema=public" \
//     pnpm --filter @expertos/api test:integration
//
// No coverage gate (this validates the database, not source-line coverage); runs serially
// with a generous timeout for the real round-trips.
module.exports = {
  ...base,
  testMatch: ["**/*.integration.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  collectCoverage: false,
  coverageThreshold: undefined,
  maxWorkers: 1,
  testTimeout: 30000,
};
