/**
 * DI token for the OD#5 legal/brand gate on Concierge **Mode B** (silent review). A human silently
 * editing an answer attributed to a named expert is the highest-liability mechanism in the app
 * (PRD Open Decision #5 / NT.1), so enabling `auto_silent` is blocked until Legal + PM sign off.
 *
 * The value is resolved once at boot from `CONCIERGE_ALLOW_SILENT` (default `false` = disallowed), so
 * the legal sign-off is a deploy-time flip, not a code change. Injected as a boolean so the service is
 * trivially unit-testable in both states.
 */
export const CONCIERGE_ALLOW_SILENT = Symbol("CONCIERGE_ALLOW_SILENT");

/** Reads the silent-review allow-flag from the environment (default disallowed). */
export function resolveSilentReviewAllowed(): boolean {
  return process.env.CONCIERGE_ALLOW_SILENT === "true";
}
