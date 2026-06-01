/**
 * Single source of truth for the M7.3 booking-provider default. Mirrors `billing.defaults.ts` /
 * `upload.defaults.ts`: one factory the running API (and any future worker) share so they can't drift
 * on which booking driver they use.
 *
 * Resolves the real {@link HttpTidyCalProvider} when `TIDYCAL_WEBHOOK_SECRET` is configured (out of
 * band via Secret Manager — never in code/env files, per PRD §"Security"); `TIDYCAL_API_TOKEN` is
 * additionally needed for the reconcile poll. Otherwise the offline default keeps the whole
 * book → webhook → consultation-sync path runnable locally and in tests.
 */
import type { TidyCalProvider } from "./tidycal-provider";
import { OfflineTidyCalProvider } from "./offline-tidycal-provider";
import { HttpTidyCalProvider } from "./http-tidycal-provider";

export function createDefaultTidyCalProvider(): TidyCalProvider {
  const webhookSecret = process.env.TIDYCAL_WEBHOOK_SECRET;
  if (webhookSecret) {
    return new HttpTidyCalProvider({
      webhookSecret,
      apiToken: process.env.TIDYCAL_API_TOKEN,
    });
  }
  return new OfflineTidyCalProvider();
}
