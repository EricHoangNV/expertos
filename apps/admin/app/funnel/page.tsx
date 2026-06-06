"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Bar, Card, Field, Select, Stat, Table } from "@expertos/ui";
import type {
  ConsultationStatusValue,
  FunnelAnalyticsDto,
  RecommendationFunnelResponse,
  RecommendationTriggerValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getFunnelAnalytics } from "../../src/lib/admin-client";
import { useStatusLabel, useT } from "../../src/lib/i18n";
import {
  consultationStatusTone,
  funnelResponseTone,
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
  const t = useT("funnel");
  const statusLabel = useStatusLabel();
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
        setError(t("errorSignIn"));
        return;
      }
      setReport(await getFunnelAnalytics(token, days));
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
          <h1 className="h1">{t("title")}</h1>
        </div>
        <Field label={t("window")}>
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
          <div className="row gap1">
            <Stat label={t("conversations", { days })} value={count(report.conversations)} />
            <Stat label={t("recommendations", { days })} value={count(report.recommendations)} />
            <Stat label={t("booked", { days })} value={count(report.byResponse.book)} />
            <Stat label={t("consultations", { days })} value={count(report.consultations)} />
            <Stat label={t("revenue", { days })} value={usd(report.bookedRevenueCents)} />
          </div>

          {/* Stage attribution (M19.4.2): each funnel stage as a horizontal bar whose fill is its
              share of the top stage (conversations = 100%), trailed by its count and its conversion
              vs. the previous stage. Revenue is a value-only row (no bar). Reuses the dashboard's
              `.funnel-card` pattern (M13.2.4) for zero new ds.css. */}
          {(() => {
            const top = report.conversations;
            const fill = (n: number): number => (top > 0 ? (n / top) * 100 : 0);
            const stages: { key: string; label: string; value: string; fill: number | null }[] = [
              {
                key: "conversations",
                label: t("stageConversations"),
                value: count(report.conversations),
                fill: fill(report.conversations),
              },
              {
                key: "recommendations",
                label: t("stageRecommendations"),
                value: `${count(report.recommendations)} · ${rate(report.recommendations, report.conversations)}`,
                fill: fill(report.recommendations),
              },
              {
                key: "booked",
                label: t("stageBooked"),
                value: `${count(report.byResponse.book)} · ${rate(report.byResponse.book, report.recommendations)}`,
                fill: fill(report.byResponse.book),
              },
              {
                key: "consultations",
                label: t("stageConsultations"),
                value: `${count(report.consultations)} · ${rate(report.consultations, report.byResponse.book)}`,
                fill: fill(report.consultations),
              },
              {
                key: "revenue",
                label: t("stageRevenue"),
                value: usd(report.bookedRevenueCents),
                fill: null,
              },
            ];
            return (
              <Card pad className="funnel-card">
                <div className="eyebrow">{t("stageAttribution")}</div>
                <div className="funnel-rows">
                  {stages.map((s) => (
                    <div key={s.key}>
                      <div className="funnel-row-head">
                        <span className="funnel-row-label">{s.label}</span>
                        <span className="funnel-row-value">{s.value}</span>
                      </div>
                      {s.fill != null && <Bar value={s.fill} aria-label={`${s.label}: ${s.value}`} />}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          <h3 className="h3">{t("byTrigger")}</h3>
          <Table>
            <thead>
              <tr>
                <th>{t("colTrigger")}</th>
                <th>{t("colRecommendations")}</th>
              </tr>
            </thead>
            <tbody>
              {TRIGGERS.map((trigger) => (
                <tr key={trigger}>
                  <td>{statusLabel(trigger)}</td>
                  <td className="mono">{count(report.byTrigger[trigger])}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h3 className="h3">{t("byResponse")}</h3>
          <div className="row gap2">
            {RESPONSES.map((r) => (
              <Badge key={r} tone={funnelResponseTone(r)}>
                {statusLabel(r)}: {count(report.byResponse[r])}
              </Badge>
            ))}
          </div>

          <h3 className="h3">{t("byStatus")}</h3>
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
