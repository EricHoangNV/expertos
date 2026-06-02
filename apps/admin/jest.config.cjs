// Jest config for the admin/expert portal (M15.2). Mirrors `apps/web/jest.config.cjs`:
// the admin pages are hook-heavy clients (auth context, locale context, fetch), so they
// need a real renderer — jsdom + Testing Library — not the node env the bare placeholder
// used. We transform with ts-jest (the repo-wide preset) rather than `next/jest`, whose
// next-swc native binary is arch-broken in this sandbox (same reason `next build` can't run).
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  // Leave `roots` at the default (`<rootDir>`) so the node-module manual mocks in
  // `<rootDir>/__mocks__/firebase/*` + `__mocks__/next/*` are auto-applied (jest looks
  // for them adjacent to node_modules). testMatch scopes where tests live.
  testMatch: ["<rootDir>/(app|src|test)/**/*.test.{ts,tsx}"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // ts-jest with jsx overridden: the app tsconfig uses `jsx: "preserve"` (Next emits JSX
  // itself) + ESM modules, neither of which Jest runs, so compile to CommonJS + the
  // automatic JSX runtime here.
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    // Pages never import CSS directly, but the design system + login styles do; stub any
    // CSS import so the module graph resolves under jsdom.
    "\\.css$": "<rootDir>/test/style-stub.cjs",
  },
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "src/**/*.{ts,tsx}",
    "!src/lib/firebase.ts", // thin SDK init wrapper; exercised via the firebase mock, not unit-tested
    "!**/*.d.ts",
  ],
};
