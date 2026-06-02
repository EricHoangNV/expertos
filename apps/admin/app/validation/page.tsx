"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Select, Stat } from "@expertos/ui";
import type { ValidationAnalyticsDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { useT } from "../../src/lib/i18n";
import { getValidationAnalytics } from "../../src/lib/admin-client";

/** Trailing-window options the dashboard offers, in days (matches the other analytics dashboards). */
const DAY_OPTIONS = [7, 30, 90, 365] as const;

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** A pre-computed fraction (`[0, 1]`) as a percentage. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Admin product-validation scorecard (M10.4, OD#1). The go/no-go dashboard the PM reviews to answer
 * the core hypothesis ("will users pay to talk to a digital Expert X"). Per the OD#1 resolution it
 * surfaces raw numbers — no thresholds; targets are set post-launch with real data. The API enforces
 * `@Roles("admin")` + the cross-tenant RLS read; this page renders the aggregates it returns.
 */
export default function ValidationPage() {
  const { getIdToken } = useAuth();
  const t = useT("validation");
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<ValidationAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setReport(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errorSignIn"));
        return;
      }
      setReport(await getValidationAnalytics(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoad"));
    }
  }, [getIdToken, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow")}</div>
          <h1 className="h1">{t("heading")}</h1>
        </div>
        <Field label={t("windowLabel")}>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t("windowOption", { days: d })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="muted">{t("intro")}</p>

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <h3 className="h3">{t("activationHeading")}</h3>
          <p className="muted">{t("activationDescription")}</p>
          <div className="row gap1">
            <Stat
              label={t("activationRate", { days })}
              value={pct(report.activation.activationRate)}
              delta={t("activationDelta", {
                activated: count(report.activation.activatedUsers),
                total: count(report.activation.newUsers),
              })}
            />
            <Stat label={t("newUsers", { days })} value={count(report.activation.newUsers)} />
            <Stat label={t("activated", { days })} value={count(report.activation.activatedUsers)} />
          </div>

          <h3 className="h3">{t("engagementHeading")}</h3>
          <p className="muted">{t("engagementDescription")}</p>
          <div className="row gap1">
            <Stat
              label={t("returnRate", { days })}
              value={pct(report.engagement.returnRate)}
              delta={t("returnDelta", {
                returned: count(report.engagement.returnedUsers),
                total: count(report.activation.newUsers),
              })}
            />
            <Stat label={t("activeUsers", { days })} value={count(report.engagement.activeUsers)} />
            <Stat label={t("questions", { days })} value={count(report.engagement.totalQuestions)} />
            <Stat
              label={t("medianQuestions")}
              value={report.engagement.medianQuestionsPerActiveUser.toLocaleString("en-US")}
            />
          </div>

          <h3 className="h3">{t("wtpHeading")}</h3>
          <p className="muted">{t("wtpDescription")}</p>
          <div className="row gap1">
            <Stat
              label={t("freeToPaid")}
              value={pct(report.willingnessToPay.freeToPaidRate)}
              delta={t("wtpDelta", {
                paying: count(report.willingnessToPay.payingUsers),
                total: count(report.willingnessToPay.totalUsers),
              })}
            />
            <Stat label={t("payingUsers")} value={count(report.willingnessToPay.payingUsers)} />
            <Stat label={t("trialingUsers")} value={count(report.willingnessToPay.trialingUsers)} />
            <Stat label={t("totalUsers")} value={count(report.willingnessToPay.totalUsers)} />
          </div>

          <h3 className="h3">{t("funnelHeading")}</h3>
          <p className="muted">{t("funnelDescription")}</p>
          <div className="row gap1">
            <Stat
              label={t("recommendationToBooking", { days })}
              value={pct(report.funnel.recommendationToBookingRate)}
              delta={t("funnelDelta", {
                bookings: count(report.funnel.bookings),
                recommendations: count(report.funnel.recommendations),
              })}
            />
            <Stat label={t("bookings", { days })} value={count(report.funnel.bookings)} />
            <Stat label={t("bookedRevenue", { days })} value={usd(report.funnel.bookedRevenueCents)} />
            <Stat
              label={t("revenuePerBuyer")}
              value={usd(report.funnel.revenuePerBookingUserCents)}
              delta={t("revenuePerBuyerDelta", { buyers: count(report.funnel.bookingUsers) })}
            />
          </div>
        </>
      )}
    </AdminFrame>
  );
}
