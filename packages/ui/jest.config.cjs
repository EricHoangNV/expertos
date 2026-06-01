// UI primitives are pure functions over ds.css class names; the design-system
// conformance rules (PRD §"Design System" — citation render-after-resolve,
// upload-vs-knowledge color, badge tones, quota meter) are mechanized as unit
// tests (M11.5), so coverage now spans the components too, not just helpers.
const base = require("../../jest.base.cjs");

module.exports = {
  ...base,
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/index.ts",
  ],
};
