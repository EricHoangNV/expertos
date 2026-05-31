import * as Sentry from "@sentry/node";
import { getRequestContext } from "./request-context";

/**
 * Error tracking via Sentry. Initialization is **lazy and opt-in**: it only activates
 * when `SENTRY_DSN` is set (production / staging). With no DSN — local dev, tests, CI —
 * every function here is a safe no-op, so nothing needs to be stubbed and no events ship.
 *
 * Mirrors the lazy-Firebase pattern (LEARNINGS #3): never do SDK setup at module load.
 */

let enabled = false;

/**
 * Initializes Sentry if `SENTRY_DSN` is configured. Idempotent and safe to call at
 * bootstrap. Returns `true` when error reporting is now active.
 */
export function initSentry(): boolean {
  if (enabled) {
    return true;
  }
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
  enabled = true;
  return true;
}

/** Whether error reporting is currently active. */
export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Reports an exception to Sentry, tagged with the active request id / trace so a Sentry
 * issue can be cross-referenced with its logs. No-op when Sentry is disabled.
 */
export function reportException(exception: unknown): void {
  if (!enabled) {
    return;
  }
  const ctx = getRequestContext();
  const tags: Record<string, string> = {};
  if (ctx?.requestId) {
    tags.requestId = ctx.requestId;
  }
  if (ctx?.traceId) {
    tags.traceId = ctx.traceId;
  }
  Sentry.captureException(exception, {
    tags: Object.keys(tags).length > 0 ? tags : undefined,
  });
}

/** Flushes buffered events (call before process exit). No-op when disabled. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) {
    return;
  }
  await Sentry.flush(timeoutMs);
}

/** Test-only: resets module state so each test starts from a clean slate. */
export function resetSentryForTests(): void {
  enabled = false;
}
