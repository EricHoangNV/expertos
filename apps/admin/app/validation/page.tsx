"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Select, Stat } from "@expertos/ui";
import type { ValidationAnalyticsDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
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
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<ValidationAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setReport(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError("Please sign in to continue.");
        return;
      }
      setReport(await getValidationAnalytics(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load validation analytics.");
    }
  }, [getIdToken, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Analytics</div>
          <h1 className="h1">Validation scorecard</h1>
        </div>
        <Field label="Window">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="muted">
        The core go/no-go signals — activation, engagement, willingness to pay, and funnel conversion.
        Raw numbers only: targets are set post-launch once real usage exists. Willingness-to-pay is
        cumulative (current platform state); the rest cover the selected window.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <h3 className="h3">Activation</h3>
          <p className="muted">New users reaching a cited answer within 24h of signing up.</p>
          <div className="row gap1">
            <Stat
              label={`Activation rate · ${days}d`}
              value={pct(report.activation.activationRate)}
              delta={`${count(report.activation.activatedUsers)} of ${count(
                report.activation.newUsers,
              )} new users`}
            />
            <Stat label={`New users · ${days}d`} value={count(report.activation.newUsers)} />
            <Stat label={`Activated · ${days}d`} value={count(report.activation.activatedUsers)} />
          </div>

          <h3 className="h3">Engagement</h3>
          <p className="muted">
            Questions asked, and whether the new cohort comes back 1–7 days after signup.
          </p>
          <div className="row gap1">
            <Stat
              label={`Return rate · ${days}d`}
              value={pct(report.engagement.returnRate)}
              delta={`${count(report.engagement.returnedUsers)} of ${count(
                report.activation.newUsers,
              )} new users returned`}
            />
            <Stat label={`Active users · ${days}d`} value={count(report.engagement.activeUsers)} />
            <Stat label={`Questions · ${days}d`} value={count(report.engagement.totalQuestions)} />
            <Stat
              label="Median questions / active user"
              value={report.engagement.medianQuestionsPerActiveUser.toLocaleString("en-US")}
            />
          </div>

          <h3 className="h3">Willingness to pay</h3>
          <p className="muted">Cumulative — paying subscribers against all users (current state).</p>
          <div className="row gap1">
            <Stat
              label="Free → paid"
              value={pct(report.willingnessToPay.freeToPaidRate)}
              delta={`${count(report.willingnessToPay.payingUsers)} of ${count(
                report.willingnessToPay.totalUsers,
              )} users`}
            />
            <Stat label="Paying users" value={count(report.willingnessToPay.payingUsers)} />
            <Stat label="Trialing users" value={count(report.willingnessToPay.trialingUsers)} />
            <Stat label="Total users" value={count(report.willingnessToPay.totalUsers)} />
          </div>

          <h3 className="h3">Funnel conversion</h3>
          <p className="muted">
            In-chat recommendation → booked consultation, and booked revenue per buyer.
          </p>
          <div className="row gap1">
            <Stat
              label={`Recommendation → booking · ${days}d`}
              value={pct(report.funnel.recommendationToBookingRate)}
              delta={`${count(report.funnel.bookings)} of ${count(
                report.funnel.recommendations,
              )} recommendations`}
            />
            <Stat label={`Bookings · ${days}d`} value={count(report.funnel.bookings)} />
            <Stat label={`Booked revenue · ${days}d`} value={usd(report.funnel.bookedRevenueCents)} />
            <Stat
              label="Revenue / buyer"
              value={usd(report.funnel.revenuePerBookingUserCents)}
              delta={`${count(report.funnel.bookingUsers)} buyers`}
            />
          </div>
        </>
      )}
    </AdminFrame>
  );
}
