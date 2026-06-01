/**
 * DI token for the OD#5 legal/brand gate on Concierge **Mode B** (silent review). A human silently
 * editing an answer attributed to a named expert is the highest-liability mechanism in the app
 * (PRD Open Decision #5 / NT.1), so enabling `auto_silent` is blocked until Legal + PM sign off.
 *
 * OD#5 is now **RESOLVED** (Mode B approved as default, ToS covers AI-reviewed content, visual
 * indicator required), so the flag defaults to **allowed**; set `CONCIERGE_ALLOW_SILENT=false` to
 * disable Mode B again (a deploy-time flip, not a code change). Injected as a boolean so the service
 * is trivially unit-testable in both states.
 */
export const CONCIERGE_ALLOW_SILENT = Symbol("CONCIERGE_ALLOW_SILENT");

/** Reads the silent-review allow-flag from the environment (default allowed — OD#5 resolved). */
export function resolveSilentReviewAllowed(): boolean {
  return process.env.CONCIERGE_ALLOW_SILENT !== "false";
}
