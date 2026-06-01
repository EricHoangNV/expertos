"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, UsageMeter } from "@expertos/ui";
import type { EntitlementsDto, EntitlementView } from "@expertos/shared";
import { useAuth } from "../../src/lib/auth-context";
import { fetchEntitlements } from "../../src/lib/account-client";

/** One metered feature rendered as a quota meter (M6.3 transparent usage indicator). */
function MeteredFeature({ feature }: { feature: EntitlementView }) {
  // A disabled metered feature isn't available on this plan at all — show that, not a 0/0 meter.
  if (!feature.enabled) {
    return (
      <div className="meter">
        <div className="meter-head">
          <span className="label">{feature.name}</span>
          <Badge tone="ink">Not included</Badge>
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
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="label">{feature.name}</span>
        <Badge tone={feature.enabled ? "green" : "ink"}>
          {feature.enabled ? "Included" : "Not included"}
        </Badge>
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, getIdToken } = useAuth();
  const [data, setData] = useState<EntitlementsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to view your plan.");
        return;
      }
      setData(await fetchEntitlements(token));
    } catch {
      setError("Couldn't load your plan and usage — please try again.");
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

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
        <h1>Plan &amp; usage</h1>
        <Badge tone="info">Please sign in on the home page to view your plan.</Badge>
      </main>
    );
  }

  const metered = data?.features.filter((f) => f.type === "metered") ?? [];
  const boolean = data?.features.filter((f) => f.type === "boolean") ?? [];

  return (
    <main className="card card-pad">
      <h1>Plan &amp; usage</h1>

      {loading && <Badge tone="info">Loading…</Badge>}
      {error && <Badge tone="red">{error}</Badge>}

      {data && (
        <>
          <Badge tone="green">Current plan: {data.plan.name}</Badge>

          {metered.length > 0 && (
            <Card className="card-pad">
              <span className="label">Usage this period</span>
              {metered.map((feature) => (
                <MeteredFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}

          {boolean.length > 0 && (
            <Card className="card-pad">
              <span className="label">Features</span>
              {boolean.map((feature) => (
                <BooleanFeature key={feature.key} feature={feature} />
              ))}
            </Card>
          )}
        </>
      )}
    </main>
  );
}
