// Shared Jest base for Node/TS packages (ts-jest). Next.js apps use next/jest.
// The 90% coverage gate is mandated by the PRD (Phase 0 §4).
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/index.ts",
    "!src/**/*.d.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  // Bound peak memory: some suites pull heavy deps (firebase-admin), and on
  // memory-constrained machines the default worker pool (cores-1) OOM-kills a
  // worker. Cap parallelism and recycle workers that grow past the limit.
  maxWorkers: 2,
  workerIdleMemoryLimit: "512MB",
};
