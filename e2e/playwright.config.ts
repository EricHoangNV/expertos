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
          env: { FIREBASE_AUTH_EMULATOR_HOST: env.authEmulatorHost },
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
      ]
    : undefined,
});
