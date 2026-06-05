"use client";

import { useT } from "../../src/lib/i18n";
import { AccountPanel } from "../../src/components/account-panel";

/**
 * The standalone `/account` route (plan & usage). Kept as a real page so direct navigation and the
 * server-chosen Stripe checkout/portal return targets land somewhere valid, with a "back to chat"
 * link so it's never a dead end. The in-app entry point is the account {@link Modal} opened from the
 * chat header — both render the same {@link AccountPanel} so the two never drift.
 */
export default function AccountPage() {
  const t = useT("account");
  return (
    <main className="card card-pad account-page">
      <a className="btn btn-ghost btn-sm" href="/chat">
        {t("backToChat")}
      </a>
      <h1>{t("heading")}</h1>
      <AccountPanel />
    </main>
  );
}
