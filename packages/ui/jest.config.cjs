// UI primitives are thin JSX wrappers over ds.css; coverage is enforced on the
// pure helpers (.ts). Component rendering is covered by app-level E2E later.
const base = require("../../jest.base.cjs");

module.exports = {
  ...base,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/index.ts"],
};
