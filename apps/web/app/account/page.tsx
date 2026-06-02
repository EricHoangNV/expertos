"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, UsageMeter } from "@expertos/ui";
import type {
  AvailablePlansDto,
  EntitlementsDto,
  EntitlementView,
  PlanPriceDto,
} from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { useT } from "../../src/lib/i18n";
import {
  fetchEntitlements,
  fetchUpgradePlans,
  openBillingPortal,
  startCheckout,
} from "../../src/lib/account-client";

/** Formats a `plan_prices` amount (cents) as a localized price, e.g. `$15.00/mo`. */
function formatPrice({ amountCents, currency, interval }: PlanPriceDto): string {
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
  return `${amount}/${interval === "month" ? "mo" : "yr"}`;
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

export default function AccountPage() {
  const { user, getIdToken } = useAuth();
  const t = useT("account");
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
    return (
      <main className="card card-pad">
        <h1>{t("heading")}</h1>
        <Badge tone="info">{t("signInPrompt")}</Badge>
      </main>
    );
  }

  const metered = data?.features.filter((f) => f.type === "metered") ?? [];
  const boolean = data?.features.filter((f) => f.type === "boolean") ?? [];

  return (
    <main className="card card-pad">
      <h1>{t("heading")}</h1>

      {loading && <Badge tone="info">{t("loading")}</Badge>}
      {error && <Badge tone="red">{error}</Badge>}

      {data && (
        <>
          <Badge tone="green">{t("currentPlan", { name: data.plan.name })}</Badge>

          {metered.length > 0 && (
            <Card className="card-pad">
              <span className="label">{t("usageThisPeriod")}</span>
              {metered.map((feature) => (
                <MeteredFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}

          {boolean.length > 0 && (
            <Card className="card-pad">
              <span className="label">{t("features")}</span>
              {boolean.map((feature) => (
                <BooleanFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}

          {plans && plans.upgrades.length > 0 && (
            <Card className="card-pad">
              <span className="label">{t("upgrade")}</span>
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
                        {t("upgradeTo", { name: plan.name, price: formatPrice(price) })}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {plans?.hasActiveSubscription && (
            <Card className="card-pad">
              <span className="label">{t("billing")}</span>
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
    </main>
  );
}
