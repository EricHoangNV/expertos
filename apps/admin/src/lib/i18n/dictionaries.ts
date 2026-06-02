import type { Locale, Messages } from "@expertos/ui";

import * as common from "./dictionaries/common";
import * as dashboard from "./dictionaries/dashboard";
import * as accessControl from "./dictionaries/access-control";
import * as analytics from "./dictionaries/analytics";
import * as answers from "./dictionaries/answers";
import * as audit from "./dictionaries/audit";
import * as concierge from "./dictionaries/concierge";
import * as conciergeAnalytics from "./dictionaries/concierge-analytics";
import * as conciergeReviews from "./dictionaries/concierge-reviews";
import * as conversions from "./dictionaries/conversions";
import * as entitlements from "./dictionaries/entitlements";
import * as experts from "./dictionaries/experts";
import * as failedQueries from "./dictionaries/failed-queries";
import * as funnel from "./dictionaries/funnel";
import * as knowledge from "./dictionaries/knowledge";
import * as knowledgeDrafts from "./dictionaries/knowledge-drafts";
import * as recommendationRules from "./dictionaries/recommendation-rules";
import * as reconcile from "./dictionaries/reconcile";
import * as retention from "./dictionaries/retention";
import * as revenue from "./dictionaries/revenue";
import * as users from "./dictionaries/users";
import * as validation from "./dictionaries/validation";
import * as voiceProfiles from "./dictionaries/voice-profiles";

/**
 * EN/VI message catalogs for the admin + expert portal (M13.3). The i18n engine (dot-path lookup +
 * `{placeholder}` interpolation) lives in `@expertos/ui` (`translate`/`createTranslator`); this layer
 * is the app-owned copy of the strings.
 *
 * Unlike the consumer web app's single `dictionaries.ts`, the admin portal spans ~25 pages, so each
 * page (route) owns its own namespace file under `./dictionaries/`. Each namespace module exports an
 * `en` and a `vi` object; this file assembles them into the per-locale catalog the provider consumes.
 *
 * Keep EN and VI in lockstep — every key present in a namespace's `en` must exist in its `vi`, or the
 * VI UI falls back to the key token (visible, greppable) for the missing string.
 */
const en: Messages = {
  common: common.en,
  dashboard: dashboard.en,
  accessControl: accessControl.en,
  analytics: analytics.en,
  answers: answers.en,
  audit: audit.en,
  concierge: concierge.en,
  conciergeAnalytics: conciergeAnalytics.en,
  conciergeReviews: conciergeReviews.en,
  conversions: conversions.en,
  entitlements: entitlements.en,
  experts: experts.en,
  failedQueries: failedQueries.en,
  funnel: funnel.en,
  knowledge: knowledge.en,
  knowledgeDrafts: knowledgeDrafts.en,
  recommendationRules: recommendationRules.en,
  reconcile: reconcile.en,
  retention: retention.en,
  revenue: revenue.en,
  users: users.en,
  validation: validation.en,
  voiceProfiles: voiceProfiles.en,
};

const vi: Messages = {
  common: common.vi,
  dashboard: dashboard.vi,
  accessControl: accessControl.vi,
  analytics: analytics.vi,
  answers: answers.vi,
  audit: audit.vi,
  concierge: concierge.vi,
  conciergeAnalytics: conciergeAnalytics.vi,
  conciergeReviews: conciergeReviews.vi,
  conversions: conversions.vi,
  entitlements: entitlements.vi,
  experts: experts.vi,
  failedQueries: failedQueries.vi,
  funnel: funnel.vi,
  knowledge: knowledge.vi,
  knowledgeDrafts: knowledgeDrafts.vi,
  recommendationRules: recommendationRules.vi,
  reconcile: reconcile.vi,
  retention: retention.vi,
  revenue: revenue.vi,
  users: users.vi,
  validation: validation.vi,
  voiceProfiles: voiceProfiles.vi,
};

/** The message catalog for each supported locale. */
export const MESSAGES: Record<Locale, Messages> = { en, vi };
