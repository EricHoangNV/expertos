const base = require("../../jest.base.cjs");

// client.ts is a thin PrismaClient singleton (a connection pool, not logic) — it can't be
// meaningfully unit-tested without a live database, so it's excluded from the coverage gate.
// Its real behavior is exercised by migration + RLS integration verification (see seed.ts).
module.exports = {
  ...base,
  collectCoverageFrom: [...base.collectCoverageFrom, "!src/client.ts"],
  // Live-DB RLS tests need a real Postgres (the `app_user` role) and are opt-in — they
  // run via `test:integration` (jest.integration.config.cjs), never in the default
  // `pnpm test` coverage run, so CI stays green on a box with no database.
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
};
