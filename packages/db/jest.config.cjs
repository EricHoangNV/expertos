const base = require("../../jest.base.cjs");

// client.ts is a thin PrismaClient singleton (a connection pool, not logic) — it can't be
// meaningfully unit-tested without a live database, so it's excluded from the coverage gate.
// Its real behavior is exercised by migration + RLS integration verification (see seed.ts).
module.exports = {
  ...base,
  collectCoverageFrom: [...base.collectCoverageFrom, "!src/client.ts"],
};
