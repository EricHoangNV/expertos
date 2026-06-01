// Coverage is enforced on services (business logic). Bootstrap, modules, and
// thin controllers are exercised by E2E in M11.
const base = require("../../jest.base.cjs");

module.exports = {
  ...base,
  collectCoverageFrom: ["src/**/*.service.ts"],
  // Live-DB integration tests (e.g. PgVectorStore against real pgvector) need a real
  // Postgres (the `app_user` role) and are opt-in — they run via `test:integration`
  // (jest.integration.config.cjs), never in the default `pnpm test` coverage run, so CI
  // stays green on a box with no database.
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
};
