/**
 * Single source of truth for the M9.3 transactional-email default. Mirrors `billing.defaults.ts` /
 * `tidycal.defaults.ts`: one factory the running API (and any future worker) share so they can't drift
 * on which mail driver they use.
 *
 * Resolves the real {@link HttpEmailProvider} when `EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM`
 * are all configured (out of band via Secret Manager — never in code/env files, per PRD §"Security");
 * otherwise the offline default keeps the whole delivery path runnable locally and in tests.
 */
import type { EmailProvider } from "./email-provider";
import { OfflineEmailProvider } from "./offline-email-provider";
import { HttpEmailProvider } from "./http-email-provider";

export function createDefaultEmailProvider(): EmailProvider {
  const apiUrl = process.env.EMAIL_API_URL;
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (apiUrl && apiKey && from) {
    return new HttpEmailProvider({ apiUrl, apiKey, from });
  }
  return new OfflineEmailProvider();
}
