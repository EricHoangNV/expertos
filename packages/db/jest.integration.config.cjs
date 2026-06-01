const base = require("../../jest.base.cjs");

// Opt-in live-database integration suite (RLS negative tests, M11.2). Run with a real
// Postgres reachable as the non-superuser `app_user` role:
//
//   RLS_TEST_DATABASE_URL="postgresql://app_user:...@localhost:5432/expertos?schema=public" \
//     pnpm --filter @expertos/db test:integration
//
// No coverage gate (this validates the database, not source-line coverage); runs serially
// so the two suites never contend on the shared test tenants, with a generous timeout for
// the real round-trips.
module.exports = {
  ...base,
  testMatch: ["**/*.integration.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  collectCoverage: false,
  coverageThreshold: undefined,
  maxWorkers: 1,
  testTimeout: 30000,
};
