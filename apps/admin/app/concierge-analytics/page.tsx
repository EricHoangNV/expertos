"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Select, Stat, Table } from "@expertos/ui";
import type { BadgeTone } from "@expertos/ui";
import {
  REVIEW_REQUEST_STATUSES,
  REVIEW_TRIGGER_MODES,
  REVIEW_VERDICTS,
  type ConciergeAnalyticsDto,
  type ReviewTriggerModeValue,
  type ReviewVerdictValue,
  type ReviewVisibilityValue,
} from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getConciergeAnalytics } from "../../src/lib/admin-client";
import { useStatusLabel, useT } from "../../src/lib/i18n";

/** Trailing-window options the dashboard offers, in days (matches the other analytics dashboards). */
const DAY_OPTIONS = [7, 30, 90, 365] as const;

/** Display order for the breakdown tables/badges (the DTO record keys). */
const VISIBILITIES: readonly ReviewVisibilityValue[] = ["visible", "silent"];

/** Dictionary keys for each trigger-mode label (Mode A vs Mode B, the concierge config language). */
const TRIGGER_MODE_LABEL_KEYS: Record<ReviewTriggerModeValue, string> = {
  user_prompted: "triggerModeUserPrompted",
  auto_silent: "triggerModeAutoSilent",
};

/** Verdict tones: `great` reads as success (green), `bad` as a hard signal (red), `good` neutral (info). */
function verdictTone(verdict: ReviewVerdictValue): BadgeTone {
  if (verdict === "great") return "green";
  if (verdict === "bad") return "red";
  return "info";
}

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** A percentage of one stage against an earlier one (em-dash when the base is empty). */
function rate(part: number, whole: number): string {
  if (whole <= 0) {
    return "—";
  }
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Mean response time in plain language (em-dash when nothing has been answered yet). */
function responseTime(minutes: number | null): string {
  if (minutes == null) {
    return "—";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

/** A short, locale-aware date for a last-flagged timestamp (em-dash when never flagged). */
function shortDate(iso: string | null): string {
  if (iso == null) {
    return "—";
  }
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Admin concierge ops dashboard (M10.3). Platform-wide human-in-the-loop metrics: review volume (by
 * status / trigger mode / visibility), SLA adherence, reviewer-verdict spread, and the knowledge-quality
 * signal from `bad`-verdict chunk flagging. The API enforces `@Roles("admin")` + the cross-tenant RLS
 * read; this page only renders the aggregates `/admin/analytics/concierge` returns.
 */
export default function ConciergeAnalyticsPage() {
  const t = useT("conciergeAnalytics");
  const statusLabel = useStatusLabel();
  const { getIdToken } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<ConciergeAnalyticsDto | null>(null);
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
      setReport(await getConciergeAnalytics(token, days));
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
            <Stat label={t("requests", { days })} value={count(report.totalRequests)} />
            <Stat label={t("answered", { days })} value={count(report.byStatus.answered)} />
            <Stat label={t("slaMet")} value={rate(report.sla.met, report.sla.tracked)} />
            <Stat label={t("avgResponse")} value={responseTime(report.sla.avgResponseMinutes)} />
            <Stat label={t("verdicts", { days })} value={count(report.verdicts.total)} />
          </div>

          <h3 className="h3">{t("slaAdherence")}</h3>
          <div className="row gap2">
            <Badge tone="info">{t("slaTracked", { count: count(report.sla.tracked) })}</Badge>
            <Badge tone="green">{t("slaMetBadge", { count: count(report.sla.met) })}</Badge>
            <Badge tone="red">{t("slaBreached", { count: count(report.sla.breached) })}</Badge>
            <Badge tone="amber">{t("slaOpenOverdue", { count: count(report.sla.openOverdue) })}</Badge>
          </div>

          <h3 className="h3">{t("byStatus")}</h3>
          <Table>
            <thead>
              <tr>
                <th>{t("colStatus")}</th>
                <th>{t("colRequests")}</th>
              </tr>
            </thead>
            <tbody>
              {REVIEW_REQUEST_STATUSES.map((s) => (
                <tr key={s}>
                  <td>{statusLabel(s)}</td>
                  <td className="mono">{count(report.byStatus[s])}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h3 className="h3">{t("byTriggerMode")}</h3>
          <div className="row gap2">
            {REVIEW_TRIGGER_MODES.map((m) => (
              <Badge key={m} tone="ink">
                {t("triggerModeBadge", {
                  label: t(TRIGGER_MODE_LABEL_KEYS[m]),
                  count: count(report.byTriggerMode[m]),
                })}
              </Badge>
            ))}
          </div>

          <h3 className="h3">{t("byVisibility")}</h3>
          <div className="row gap2">
            {VISIBILITIES.map((v) => (
              <Badge key={v} tone={v === "visible" ? "info" : "ink"}>
                {t("visibilityBadge", { label: statusLabel(v), count: count(report.byVisibility[v]) })}
              </Badge>
            ))}
          </div>

          <h3 className="h3">{t("reviewerVerdicts")}</h3>
          <div className="row gap2">
            {REVIEW_VERDICTS.map((v) => (
              <Badge key={v} tone={verdictTone(v)}>
                {t("verdictBadge", { label: statusLabel(v), count: count(report.verdicts.byVerdict[v]) })}
              </Badge>
            ))}
          </div>
          <div className="row gap2">
            <Badge tone="info">{t("edited", { count: count(report.verdicts.edited) })}</Badge>
            <Badge tone="info">{t("delivered", { count: count(report.verdicts.delivered) })}</Badge>
          </div>

          <h3 className="h3">{t("knowledgeQuality")}</h3>
          <div className="row gap1">
            <Stat label={t("flaggedChunks")} value={count(report.knowledge.flaggedChunks)} />
            <Stat label={t("totalFlags")} value={count(report.knowledge.totalFlags)} />
            <Stat label={t("recentlyFlagged", { days })} value={count(report.knowledge.recentlyFlagged)} />
          </div>
          {report.knowledge.topFlagged.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>{t("colFlaggedSourceChunk")}</th>
                  <th>{t("colFlags")}</th>
                  <th>{t("colLastFlagged")}</th>
                </tr>
              </thead>
              <tbody>
                {report.knowledge.topFlagged.map((c) => (
                  <tr key={c.chunkId}>
                    <td>{c.excerpt}</td>
                    <td className="mono">{count(c.flagCount)}</td>
                    <td>{shortDate(c.lastFlaggedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </AdminFrame>
  );
}
