"use client";

import { useCallback, useEffect, useState } from "react";
import {
  avatarInitials,
  avatarTone,
  Badge,
  Button,
  Card,
  formatCurrency,
  UsageMeter,
  type Locale,
  type Translator,
} from "@expertos/ui";
import type {
  AvailablePlansDto,
  EntitlementsDto,
  EntitlementView,
  PlanPriceDto,
} from "@expertos/shared";
import { useAuth } from "../lib/auth-context";
import { useLocale, useT } from "../lib/i18n";
import {
  fetchEntitlements,
  fetchUpgradePlans,
  openBillingPortal,
  startCheckout,
} from "../lib/account-client";

/** Formats a `plan_prices` amount (cents) as a locale-aware price, e.g. EN `$15.00/mo` / VI `15,00 US$/tháng`. */
function formatPrice(
  { amountCents, currency, interval }: PlanPriceDto,
  locale: Locale,
  t: Translator,
): string {
  const amount = formatCurrency(locale, amountCents / 100, currency);
  return `${amount}/${interval === "month" ? t("perMonth") : t("perYear")}`;
}

/** One metered feature rendered as a quota meter (M6.3 transparent usage indicator). */
function MeteredFeature({ feature }: { feature: EntitlementView }) {
  const t = useT("account");
  // A disabled metered feature isn't available on this plan at all — show that, not a 0/0 meter.
  if (!feature.enabled) {
    return (
      <div className="meter">
        <div className="meter-head">
          <span className="label">{feature.name}</span>
          <Badge tone="ink">{t("notIncluded")}</Badge>
        </div>
      </div>
    );
  }
  return (
    <UsageMeter
      label={feature.name}
      used={feature.used ?? 0}
      limit={feature.limit ?? null}
      softLimit={feature.softLimit ?? null}
    />
  );
}

/** One boolean feature rendered as an included / not-included badge. */
function BooleanFeature({ feature }: { feature: EntitlementView }) {
  const t = useT("account");
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="label">{feature.name}</span>
        <Badge tone={feature.enabled ? "green" : "ink"}>
          {feature.enabled ? t("included") : t("notIncluded")}
        </Badge>
      </div>
    </div>
  );
}

/**
 * The account identity header (M19.1.2, screenshot 03): an avatar (initials on an expert-style
 * colored circle), the "Account" title, and the signed-in email. Rendered as the modal head's left
 * slot (the chat-header popup) and at the top of the standalone `/account` route, so both surfaces
 * share one identity block and never drift. Returns nothing when signed out — the panel below then
 * shows the sign-in prompt instead.
 */
export function AccountIdentityHeader() {
  const { user } = useAuth();
  const t = useT("account");
  if (!user) return null;
  const seed = user.displayName?.trim() || user.email?.split("@")[0]?.trim() || "You";
  return (
    <div className="account-identity">
      <span className={`avatar avatar-lg tone-${avatarTone(seed)}`} aria-hidden="true">
        {avatarInitials(seed)}
      </span>
      <div className="account-identity-text">
        <h2 className="h2 modal-title">{t("modalTitle")}</h2>
        {user.email && <span className="muted">{user.email}</span>}
      </div>
    </div>
  );
}

/**
 * The plan & usage surface (M6.1/M6.3): the current-plan badge, per-feature usage meters + boolean
 * rows, the self-serve upgrade CTA (→ `POST /billing/checkout`, M6.2), and the customer-portal
 * "Manage billing" link. Rendered both by the standalone `/account` route and, as a popup, inside the
 * chat workspace's account {@link Modal} (M12.3.3 entry point) — the inner content only; the
 * {@link AccountIdentityHeader} (avatar + "Account" + email) is supplied by the host above it (the
 * modal head's left slot, the route's top). The signed-out state is a single sign-in prompt badge.
 */
export function AccountPanel() {
  const { user, getIdToken } = useAuth();
  const t = useT("account");
  const { locale } = useLocale();
  const [data, setData] = useState<EntitlementsDto | null>(null);
  const [plans, setPlans] = useState<AvailablePlansDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("signInToView"));
        return;
      }
      const [entitlements, upgradePlans] = await Promise.all([
        fetchEntitlements(token),
        fetchUpgradePlans(token),
      ]);
      setData(entitlements);
      setPlans(upgradePlans);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [getIdToken, t]);

  /** Resolves a fresh token then runs a billing redirect (checkout/portal), surfacing failures. */
  const redirectTo = useCallback(
    async (resolveUrl: (token: string) => Promise<string>) => {
      setBusy(true);
      setActionError(null);
      try {
        const token = await getIdToken();
        if (!token) {
          setActionError(t("signInAgain"));
          return;
        }
        window.location.href = await resolveUrl(token);
      } catch {
        setActionError(t("billingError"));
        setBusy(false);
      }
    },
    [getIdToken, t],
  );

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, load]);

  if (!user) {
    return <Badge tone="info">{t("signInPrompt")}</Badge>;
  }

  const metered = data?.features.filter((f) => f.type === "metered") ?? [];
  const boolean = data?.features.filter((f) => f.type === "boolean") ?? [];

  return (
    <>
      {loading && <Badge tone="info">{t("loading")}</Badge>}
      {error && <Badge tone="red">{error}</Badge>}

      {data && (
        <>
          <Badge tone="green">{t("currentPlan", { name: data.plan.name })}</Badge>

          {metered.length > 0 && (
            <Card className="card-pad">
              <span className="eyebrow">{t("usageThisPeriod")}</span>
              {metered.map((feature) => (
                <MeteredFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}

          {boolean.length > 0 && (
            <Card className="card-pad">
              <span className="eyebrow">{t("features")}</span>
              {boolean.map((feature) => (
                <BooleanFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}

          {plans && plans.upgrades.length > 0 && (
            <Card className="card-pad">
              <span className="eyebrow">{t("upgrade")}</span>
              {actionError && <Badge tone="red">{actionError}</Badge>}
              {plans.upgrades.map((plan) => (
                <div key={plan.key} className="meter">
                  <div className="meter-head">
                    <span className="label">{plan.name}</span>
                  </div>
                  <div className="row gap2">
                    {plan.prices.map((price) => (
                      <Button
                        key={price.interval}
                        variant="dark"
                        disabled={busy}
                        onClick={() =>
                          void redirectTo((token) =>
                            startCheckout(token, plan.key, price.interval),
                          )
                        }
                      >
                        {t("upgradeTo", { name: plan.name, price: formatPrice(price, locale, t) })}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {plans?.hasActiveSubscription && (
            <Card className="card-pad">
              <span className="eyebrow">{t("billing")}</span>
              {actionError && plans.upgrades.length === 0 && (
                <Badge tone="red">{actionError}</Badge>
              )}
              <Button
                variant="subtle"
                disabled={busy}
                onClick={() => void redirectTo((token) => openBillingPortal(token))}
              >
                {t("manageBilling")}
              </Button>
            </Card>
          )}
        </>
      )}
    </>
  );
}
