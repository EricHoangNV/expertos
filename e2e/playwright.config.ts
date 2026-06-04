import { defineConfig, devices } from "@playwright/test";
import { env } from "./fixtures/env";

/**
 * E2E configuration for the ExpertOS web + admin apps (PRD §"Testing Strategy", M11.1).
 *
 * These specs drive a **live stack**: the API, both Next.js apps, a Postgres+pgvector
 * database, and the Firebase Auth **emulator**. See `e2e/README.md` for how to bring the
 * stack up and seed it. The suite is intentionally excluded from the default `pnpm test`
 * (it has no `test` script) — run it with `pnpm --filter @expertos/e2e test:e2e`.
 *
 * Set `E2E_NO_WEBSERVER=1` when you start the app processes yourself (the default config
 * lets Playwright boot/attach to them, but it cannot boot the DB or the Auth emulator).
 */
const manageServers = process.env.E2E_NO_WEBSERVER !== "1";

// Which app servers Playwright should boot this run. `webServer` would otherwise start ALL three
// (api/web/admin) regardless of which specs run, so a flow that only exercises web would still need
// a production build of admin (and vice-versa) or fail at startup. The test-e2e-{users,admin}.sh
// scripts set E2E_APPS to just the apps their spec group touches (api is always needed); default to
// all three so a bare `pnpm test:e2e` still boots the full stack.
const requestedApps = new Set(
  (process.env.E2E_APPS ?? "api web admin").split(/[,\s]+/).filter(Boolean),
);

/** NEXT_PUBLIC_* the web/admin dev servers need to talk to the API + Auth emulator. */
const webClientEnv: Record<string, string> = {
  NEXT_PUBLIC_API_URL: env.apiBaseUrl,
  NEXT_PUBLIC_FIREBASE_API_KEY: env.firebaseApiKey,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: env.firebaseProjectId,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${env.firebaseProjectId}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: env.authEmulatorHost,
};

export default defineConfig({
  testDir: "./specs",
  // Mirrors the test identities + promotes the expert/admin roles the gated portal specs
  // need, against the live stack (see global-setup.ts). Runs once before the suite.
  globalSetup: "./global-setup.ts",
  // Purges everything the run created/seeded so the shared stack returns to baseline
  // (DIRECTIVE #49 / §3.4.3 — see global-teardown.ts). Runs once after the suite.
  globalTeardown: "./global-teardown.ts",
  // Each spec mutates shared server state (knowledge, conversations), so run files in
  // order within a worker; keep a single worker to avoid cross-test interference.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: env.webBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: manageServers
    ? [
        {
          name: "api",
          command: "pnpm --filter @expertos/api start",
          url: `${env.apiBaseUrl}/health`,
          reuseExistingServer: true,
          timeout: 120_000,
          // No service-account cert in emulator mode — the API initializes with just the
          // project id (must match the project the web/admin clients mint tokens under).
          env: {
            FIREBASE_AUTH_EMULATOR_HOST: env.authEmulatorHost,
            FIREBASE_PROJECT_ID: env.firebaseProjectId,
            // The per-IP rate limiter (M11.2) defaults to 300 req/60s. Every request in this
            // single-machine run originates from one loopback IP, so the whole suite shares one
            // bucket and bursts (page loads × API calls × specs) trip the limiter, surfacing as
            // sporadic "couldn't load" errors. Relax it for the test stack — prod sees many IPs.
            RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? "100000",
          },
        },
        {
          name: "web",
          command: "pnpm --filter @expertos/web start --port 3000",
          url: env.webBaseUrl,
          reuseExistingServer: true,
          timeout: 120_000,
          env: webClientEnv,
        },
        {
          name: "admin",
          command: "pnpm --filter @expertos/admin start --port 3002",
          url: env.adminBaseUrl,
          reuseExistingServer: true,
          timeout: 120_000,
          env: webClientEnv,
        },
      ].filter((server) => requestedApps.has(server.name))
    : undefined,
});
