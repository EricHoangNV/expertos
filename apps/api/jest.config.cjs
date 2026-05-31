// Coverage is enforced on services (business logic). Bootstrap, modules, and
// thin controllers are exercised by E2E in M11.
const base = require("../../jest.base.cjs");

module.exports = {
  ...base,
  collectCoverageFrom: ["src/**/*.service.ts"],
};
