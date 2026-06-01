"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Select, Stat, Table } from "@expertos/ui";
import type {
  ConsultationStatusValue,
  FunnelAnalyticsDto,
  RecommendationFunnelResponse,
  RecommendationTriggerValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getFunnelAnalytics } from "../../src/lib/admin-client";
import {
  consultationStatusTone,
  funnelResponseTone,
  statusLabel,
} from "../../src/lib/status-tone";

/** Trailing-window options the dashboard offers, in days (matches the usage dashboard). */
const DAY_OPTIONS = [7, 30, 90, 365] as const;

/** Display order for the breakdown tables (matches the DTO record keys). */
const TRIGGERS: readonly RecommendationTriggerValue[] = [
  "topic",
  "depth",
  "low_confidence",
  "high_intent",
];
const RESPONSES: readonly RecommendationFunnelResponse[] = [
  "book",
  "maybe_later",
  "ask_another",
  "pending",
];
const STATUSES: readonly ConsultationStatusValue[] = [
  "recommended",
  "booked",
  "confirmed",
  "completed",
  "canceled",
  "no_show",
];

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** Conversion rate as a percentage of one stage against an earlier one (0 when the base is empty). */
function rate(part: number, whole: number): string {
  if (whole <= 0) {
    return "—";
  }
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Admin consultation-funnel dashboard (M10.2). Platform-wide attribution: conversations →
 * recommendations → bookings → revenue. The API enforces `@Roles("admin")` + the cross-tenant RLS
 * read; this page just renders the aggregates the `/admin/analytics/funnel` read returns.
 */
export default function FunnelPage() {
  const { getIdToken } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<FunnelAnalyticsDto | null>(null);
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
      setReport(await getFunnelAnalytics(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load funnel analytics.");
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
          <h1 className="h1">Consultation funnel</h1>
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
        Platform-wide attribution from conversation to booked revenue. Consultation counts and revenue
        cover only consultations that arose from an in-chat recommendation.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <div className="row gap1">
            <Stat label={`Conversations · ${days}d`} value={count(report.conversations)} />
            <Stat label={`Recommendations · ${days}d`} value={count(report.recommendations)} />
            <Stat label={`Booked · ${days}d`} value={count(report.byResponse.book)} />
            <Stat label={`Consultations · ${days}d`} value={count(report.consultations)} />
            <Stat label={`Revenue · ${days}d`} value={usd(report.bookedRevenueCents)} />
          </div>

          <div className="row gap1">
            <Stat
              label="Conversation → recommendation"
              value={rate(report.recommendations, report.conversations)}
            />
            <Stat
              label="Recommendation → booked"
              value={rate(report.byResponse.book, report.recommendations)}
            />
          </div>

          <h3 className="h3">Recommendations by trigger</h3>
          <Table>
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Recommendations</th>
              </tr>
            </thead>
            <tbody>
              {TRIGGERS.map((t) => (
                <tr key={t}>
                  <td>{statusLabel(t)}</td>
                  <td className="mono">{count(report.byTrigger[t])}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h3 className="h3">Recommendations by response</h3>
          <div className="row gap2">
            {RESPONSES.map((r) => (
              <Badge key={r} tone={funnelResponseTone(r)}>
                {statusLabel(r)}: {count(report.byResponse[r])}
              </Badge>
            ))}
          </div>

          <h3 className="h3">Consultations by status</h3>
          <div className="row gap2">
            {STATUSES.map((s) => (
              <Badge key={s} tone={consultationStatusTone(s)}>
                {statusLabel(s)}: {count(report.byConsultationStatus[s])}
              </Badge>
            ))}
          </div>
        </>
      )}
    </AdminFrame>
  );
}
