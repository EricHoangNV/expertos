// Jest config for the consumer web app (M15.1). Next.js app pages are hook-heavy
// clients (auth context, locale context, fetch), so unlike the pure-function
// `@expertos/ui` primitives they need a real renderer: jsdom + Testing Library.
//
// We deliberately transform with ts-jest (the repo-wide preset) rather than
// `next/jest`: next/jest pulls in the next-swc native binary, which is arch-broken
// in this sandbox (same reason `next build` can't run here). ts-jest needs no
// native binary and matches every other workspace's setup.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  // Leave `roots` at the default (`<rootDir>`) so the node-module manual mocks in
  // `<rootDir>/__mocks__/firebase/*` are auto-applied (jest looks for them adjacent
  // to node_modules). testMatch + testPathIgnorePatterns scope where tests live.
  testMatch: ["<rootDir>/(app|src|test)/**/*.test.{ts,tsx}"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // ts-jest with jsx overridden: the app tsconfig uses `jsx: "preserve"` (Next
  // emits JSX itself) + ESM modules, neither of which Jest can run, so we compile
  // to classic CommonJS + the automatic JSX runtime here.
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
    // Pages never import CSS directly, but the design system + login styles do;
    // stub any CSS import so the module graph resolves under jsdom.
    "\\.css$": "<rootDir>/test/style-stub.cjs",
  },
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "src/**/*.{ts,tsx}",
    "!src/lib/firebase.ts", // thin SDK init wrapper; exercised via the firebase mock, not unit-tested
    "!**/*.d.ts",
  ],
};
