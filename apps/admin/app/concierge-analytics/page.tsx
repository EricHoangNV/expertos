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
import { statusLabel } from "../../src/lib/status-tone";

/** Trailing-window options the dashboard offers, in days (matches the other analytics dashboards). */
const DAY_OPTIONS = [7, 30, 90, 365] as const;

/** Display order for the breakdown tables/badges (the DTO record keys). */
const VISIBILITIES: readonly ReviewVisibilityValue[] = ["visible", "silent"];

/** Human label for a trigger mode (Mode A vs Mode B, the language the concierge config uses). */
const TRIGGER_MODE_LABELS: Record<ReviewTriggerModeValue, string> = {
  user_prompted: "User-prompted (Mode A)",
  auto_silent: "Auto-silent (Mode B)",
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
        setError("Please sign in to continue.");
        return;
      }
      setReport(await getConciergeAnalytics(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load concierge analytics.");
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
          <h1 className="h1">Concierge ops</h1>
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
        Platform-wide human-in-the-loop metrics. Request and verdict counts cover the window; the
        knowledge-quality flag counts are cumulative.
      </p>

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <div className="row gap1">
            <Stat label={`Requests · ${days}d`} value={count(report.totalRequests)} />
            <Stat label={`Answered · ${days}d`} value={count(report.byStatus.answered)} />
            <Stat label="SLA met" value={rate(report.sla.met, report.sla.tracked)} />
            <Stat label="Avg response" value={responseTime(report.sla.avgResponseMinutes)} />
            <Stat label={`Verdicts · ${days}d`} value={count(report.verdicts.total)} />
          </div>

          <h3 className="h3">SLA adherence</h3>
          <div className="row gap2">
            <Badge tone="info">Tracked: {count(report.sla.tracked)}</Badge>
            <Badge tone="green">Met: {count(report.sla.met)}</Badge>
            <Badge tone="red">Breached: {count(report.sla.breached)}</Badge>
            <Badge tone="amber">Open &amp; overdue: {count(report.sla.openOverdue)}</Badge>
          </div>

          <h3 className="h3">Requests by status</h3>
          <Table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Requests</th>
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

          <h3 className="h3">Requests by trigger mode</h3>
          <div className="row gap2">
            {REVIEW_TRIGGER_MODES.map((m) => (
              <Badge key={m} tone="ink">
                {TRIGGER_MODE_LABELS[m]}: {count(report.byTriggerMode[m])}
              </Badge>
            ))}
          </div>

          <h3 className="h3">Requests by visibility</h3>
          <div className="row gap2">
            {VISIBILITIES.map((v) => (
              <Badge key={v} tone={v === "visible" ? "info" : "ink"}>
                {statusLabel(v)}: {count(report.byVisibility[v])}
              </Badge>
            ))}
          </div>

          <h3 className="h3">Reviewer verdicts</h3>
          <div className="row gap2">
            {REVIEW_VERDICTS.map((v) => (
              <Badge key={v} tone={verdictTone(v)}>
                {statusLabel(v)}: {count(report.verdicts.byVerdict[v])}
              </Badge>
            ))}
          </div>
          <div className="row gap2">
            <Badge tone="info">Edited: {count(report.verdicts.edited)}</Badge>
            <Badge tone="info">Delivered: {count(report.verdicts.delivered)}</Badge>
          </div>

          <h3 className="h3">Knowledge quality (cumulative)</h3>
          <div className="row gap1">
            <Stat label="Flagged chunks" value={count(report.knowledge.flaggedChunks)} />
            <Stat label="Total flags" value={count(report.knowledge.totalFlags)} />
            <Stat label={`Flagged · ${days}d`} value={count(report.knowledge.recentlyFlagged)} />
          </div>
          {report.knowledge.topFlagged.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>Flagged source chunk</th>
                  <th>Flags</th>
                  <th>Last flagged</th>
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
