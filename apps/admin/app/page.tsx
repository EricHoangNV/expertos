"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Bar, Card, Stat, StackedBar, cx, relativeTime, type Translator } from "@expertos/ui";
import type {
  ConciergeAnalyticsDto,
  FailedQueryDto,
  FunnelAnalyticsDto,
  KnowledgePipelineDto,
  PublishStatusValue,
  QuestionsAnalyticsDto,
  QuestionsPeriodDto,
  RevenueReportDto,
  ValidationAnalyticsDto,
} from "@expertos/shared";
import { AdminFrame } from "../src/components/AdminFrame";
import { useAuth } from "../src/lib/auth-context";
import { useT } from "../src/lib/i18n";
import {
  getConciergeAnalytics,
  getFailedQueries,
  getFunnelAnalytics,
  getKnowledgePipeline,
  getQuestionsAnalytics,
  getRevenueReport,
  getValidationAnalytics,
} from "../src/lib/admin-client";

/**
 * Admin dashboard / home (M13.2.1 + M13.2.2). The console landing page: a greeting + validation-loop
 * subtitle + a 7d / 30d / QTD time-range control, over a 4-up grid of KPI stat cards wired to the
 * existing analytics APIs (revenue + funnel + validation). Read-only — every endpoint is
 * `@Roles("admin")` + cross-tenant RLS on the API; this page renders the aggregates they return.
 *
 * Metric note: the mockup's "Citation resolve rate" is not a measured platform metric — citation
 * resolvability is *enforced* by render-after-resolve (OD#7), never sampled — so the fourth KPI shows
 * the genuine make-or-break activation signal (new users reaching a cited answer) instead.
 */

/** Time-range options the dashboard offers. `qtd` = quarter-to-date (resolved to a day count). */
type Range = "7d" | "30d" | "qtd";

const RANGES: { id: Range; label: string }[] = [
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "qtd", label: "QTD" },
];

/** Whole days (incl. today) the selected range covers; QTD counts from the start of the quarter. */
function rangeDays(range: Range): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const days = Math.floor((now.getTime() - quarterStart.getTime()) / 86_400_000) + 1;
  return Math.min(365, Math.max(1, days));
}

/** A human greeting keyed off the local hour. */
function greeting(t: Translator): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("greeting.morning");
  if (hour < 18) return t("greeting.afternoon");
  return t("greeting.evening");
}

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** A pre-computed fraction (`[0, 1]`) as a percentage. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** A part/whole share as a whole-number percentage (0% when the whole is empty). */
function share(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/** A part/whole conversion rate as a one-decimal percentage ("—" when the base is empty). */
function ratePct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Integer cents as a whole-dollar USD amount (KPI display — no cents shown). */
function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Month-over-month change in the revenue series' net, as a signed-percentage delta line + trend. The
 * series is oldest-first; we compare the latest month against the one before it. Returns null when
 * there aren't two months, or the prior month was zero (no meaningful base).
 */
function mrrDelta(report: RevenueReportDto, t: Translator): { text: string; trend: "up" | "down" } | null {
  const periods = report.periods;
  if (periods.length < 2) return null;
  const latest = periods[periods.length - 1];
  const prior = periods[periods.length - 2];
  if (prior.netCents === 0) return null;
  const change = (latest.netCents - prior.netCents) / prior.netCents;
  const trend = change >= 0 ? "up" : "down";
  const changeText = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}`;
  return { text: t("kpi.mrrDelta", { change: changeText }), trend };
}

/** How many flagged/low-confidence queries the dashboard preview card shows. */
const LOWCONF_PREVIEW = 6;

/**
 * Mean time-to-answer (minutes) as a compact "21h 04m" display, "—" when no requests have been
 * answered yet (`avgResponseMinutes === null`). Minutes are zero-padded; sub-hour times read "0h NNm".
 */
function durationDisplay(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

interface DashboardData {
  revenue: RevenueReportDto;
  funnel: FunnelAnalyticsDto;
  validation: ValidationAnalyticsDto;
  questions: QuestionsAnalyticsDto;
  pipeline: KnowledgePipelineDto;
  failedQueries: FailedQueryDto[];
  concierge: ConciergeAnalyticsDto;
}

/**
 * Questions Answered card (M13.2.3): the window's total answers, a grounded / low-confidence /
 * insufficient badge row, an overall proportional `.progress-bar-stacked`, and a daily stacked-column
 * trend. The partition is by citation count (the only grounding signal the system stores) — see
 * {@link QuestionsAnalyticsDto}.
 */
/**
 * Expands the DTO's sparse series (`periods` carries only days with activity) into one entry per
 * day across the whole window, so the trend chart always spans the full range — empty days render
 * as a flat baseline column instead of the active days collapsing to fill the width. Keys are
 * `YYYY-MM-DD` in UTC to match the DTO's day buckets (`since` is the UTC start-of-day).
 */
function fullDailySeries(data: QuestionsAnalyticsDto): QuestionsPeriodDto[] {
  const byDay = new Map(data.periods.map((p) => [p.period, p]));
  const start = new Date(data.since);
  return Array.from({ length: data.windowDays }, (_, i) => {
    const key = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return byDay.get(key) ?? { period: key, grounded: 0, lowConfidence: 0, insufficient: 0 };
  });
}

function QuestionsCard({ data }: { data: QuestionsAnalyticsDto }) {
  const t = useT("dashboard");
  const { total, breakdown } = data;
  const series = fullDailySeries(data);
  const maxDay = series.reduce(
    (max, p) => Math.max(max, p.grounded + p.lowConfidence + p.insufficient),
    0,
  );
  const height = (c: number): string =>
    maxDay > 0 && Number.isFinite(c) ? `${(c / maxDay) * 100}%` : "0%";

  return (
    <Card pad className="qa-card">
      <div className="label">{t("questions.title")}</div>
      <div className="qa-total">{count(total)}</div>
      <div className="qa-badges">
        <Badge tone="green">{t("questions.grounded", { share: share(breakdown.grounded, total) })}</Badge>
        <Badge tone="red">{t("questions.lowConf", { share: share(breakdown.lowConfidence, total) })}</Badge>
        <Badge tone="ink">{t("questions.insufficient", { share: share(breakdown.insufficient, total) })}</Badge>
      </div>
      <StackedBar
        className="qa-overall"
        segments={[
          {
            value: breakdown.grounded,
            tone: "grounded",
            label: t("questions.groundedLabel", { count: count(breakdown.grounded) }),
          },
          {
            value: breakdown.lowConfidence,
            tone: "lowconf",
            label: t("questions.lowConfLabel", { count: count(breakdown.lowConfidence) }),
          },
          {
            value: breakdown.insufficient,
            tone: "insufficient",
            label: t("questions.insufficientLabel", { count: count(breakdown.insufficient) }),
          },
        ]}
      />
      {data.periods.length > 0 ? (
        <div className="qa-chart" aria-hidden>
          {series.map((p) => (
            <div
              className="qa-col"
              key={p.period}
              title={t("questions.colTitle", {
                period: p.period,
                count: count(p.grounded + p.lowConfidence + p.insufficient),
              })}
            >
              <i className="seg-insufficient" style={{ height: height(p.insufficient) }} />
              <i className="seg-lowconf" style={{ height: height(p.lowConfidence) }} />
              <i className="seg-grounded" style={{ height: height(p.grounded) }} />
            </div>
          ))}
        </div>
      ) : (
        <p className="muted qa-empty">{t("questions.empty")}</p>
      )}
    </Card>
  );
}

/**
 * Consultation Funnel card (M13.2.4): the question → recommendation → booking → revenue chain as
 * horizontal proportional `.bar` rows plus a recommend→book conversion + average-booking summary.
 * Each count row's fill is its share of the funnel top (conversations); the revenue row tracks the
 * booked row's width (revenue is produced by the booked consultations). All counts cover the window.
 */
function FunnelCard({ data }: { data: FunnelAnalyticsDto }) {
  const t = useT("dashboard");
  const { conversations, recommendations, byResponse, bookedRevenueCents } = data;
  const booked = byResponse.book;
  const fill = (part: number): number => (conversations > 0 ? (part / conversations) * 100 : 0);

  const rows: { key: string; label: string; value: string; fill: number }[] = [
    { key: "questions", label: t("funnel.questions"), value: count(conversations), fill: 100 },
    { key: "recommend", label: t("funnel.recommend"), value: count(recommendations), fill: fill(recommendations) },
    { key: "booked", label: t("funnel.booked"), value: count(booked), fill: fill(booked) },
    { key: "revenue", label: t("funnel.revenue"), value: usd(bookedRevenueCents), fill: fill(booked) },
  ];

  const avgBooking = booked > 0 ? usd(bookedRevenueCents / booked) : "—";

  return (
    <Card pad className="funnel-card">
      <div className="label">{t("funnel.title")}</div>
      <div className="funnel-rows">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="funnel-row-head">
              <span className="funnel-row-label">{r.label}</span>
              <span className="funnel-row-value">{r.value}</span>
            </div>
            <Bar value={r.fill} aria-label={t("funnel.rowAria", { label: r.label, value: r.value })} />
          </div>
        ))}
      </div>
      <p className="muted funnel-summary">
        {t("funnel.summary", { rate: ratePct(booked, recommendations), avg: avgBooking })}
      </p>
    </Card>
  );
}

/**
 * Knowledge Pipeline card (M13.2.6): how many knowledge documents currently sit in each stage of the
 * M8.1 publish lifecycle, as a status row (badge tone + count) per stage — DRAFT (ink) → AI PROCESSING
 * (info) → EXPERT REVIEW (amber) → PUBLISHED (green) — plus a "Review queue →" link to the full
 * approval view. `archived` is omitted (retired docs aren't part of the active pipeline). Wired to
 * {@link getKnowledgePipeline} (`/admin/analytics/knowledge-pipeline`).
 */
function KnowledgePipelineCard({ data }: { data: KnowledgePipelineDto }) {
  const t = useT("dashboard");
  const stages: { status: PublishStatusValue; label: string; tone: "ink" | "info" | "amber" | "green" }[] = [
    { status: "draft", label: t("pipeline.draft"), tone: "ink" },
    { status: "ai_processing", label: t("pipeline.aiProcessing"), tone: "info" },
    { status: "expert_review", label: t("pipeline.expertReview"), tone: "amber" },
    { status: "published", label: t("pipeline.published"), tone: "green" },
  ];

  return (
    <Card pad className="pipeline-card">
      <div className="pipeline-head">
        <div className="label">{t("pipeline.title")}</div>
        <Link href="/knowledge" className="btn btn-ghost btn-sm">
          {t("pipeline.reviewQueue")}
        </Link>
      </div>
      <div className="pipeline-rows">
        {stages.map((s) => (
          <div className="pipeline-row" key={s.status}>
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="pipeline-count mono">{count(data.byStatus[s.status])}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Concierge SLA card (M13.2.7): a dark card ({@link ../../packages/ui `.dark-card`}, M13.7.2) showing
 * the mean time-to-answer for the concierge review queue against the team's 24h target, with the count
 * of still-open requests and an "Open queue →" link to the reviewer queue. Wired to
 * {@link getConciergeAnalytics} (`/admin/analytics/concierge`). The 24h target is the M9.1 default SLA;
 * the dashboard states it as plain copy rather than re-fetching `review_configs`.
 */
function ConciergeSlaCard({ data }: { data: ConciergeAnalyticsDto }) {
  const t = useT("dashboard");
  const openQueue = data.byStatus.requested + data.byStatus.in_review;

  return (
    <Card pad className="dark-card sla-card">
      <div className="sla-head">
        <div className="label">{t("sla.title")}</div>
        <Badge tone="amber">{t("sla.inQueue", { count: count(openQueue) })}</Badge>
      </div>
      <div className="sla-time">{durationDisplay(data.sla.avgResponseMinutes)}</div>
      <p className="sla-sub muted">{t("sla.sub")}</p>
      <Link href="/concierge-reviews" className="btn btn-sm">
        {t("sla.openQueue")}
      </Link>
    </Card>
  );
}

/** Confidence-circle tone on a red→amber scale (lower confidence reads redder). */
function confTone(confidence: number): "conf-low" | "conf-mid" {
  return confidence < 0.6 ? "conf-low" : "conf-mid";
}

/**
 * Low-Confidence & Failed Queries card (M13.2.5): a preview of the answers users flagged unhelpful — the
 * signal that drives the content roadmap. Each row shows a confidence circle (red→amber scale, or a
 * neutral dash when the answer cited nothing / has no recorded score), the question, and a muted
 * metadata line (reason · model · time + an insufficient-knowledge badge). "Open pipeline →" and the
 * per-row "Draft knowledge" links route to the full inspector / draft pipeline (the dashboard card is
 * a read-only preview). Wired to {@link getFailedQueries} (`/admin/failed-queries`).
 */
function LowConfidenceCard({ rows }: { rows: FailedQueryDto[] }) {
  const t = useT("dashboard");
  return (
    <Card pad className="lowconf-card">
      <div className="lowconf-head">
        <div>
          <div className="eyebrow">{t("lowconf.eyebrow")}</div>
          <h2 className="h3">{t("lowconf.title")}</h2>
        </div>
        <Link href="/failed-queries" className="btn btn-ghost btn-sm">
          {t("lowconf.openPipeline")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="muted">{t("lowconf.empty")}</p>
      ) : (
        <div className="lowconf-list">
          {rows.map((row) => {
            const hasScore = row.confidence != null && Number.isFinite(row.confidence);
            return (
              <div className="lowconf-item" key={row.feedbackId}>
                <div
                  className={cx(
                    "conf-circle",
                    hasScore && confTone(row.confidence as number),
                  )}
                  title={
                    hasScore
                      ? t("lowconf.confidenceTitle", { score: (row.confidence as number).toFixed(2) })
                      : t("lowconf.noScore")
                  }
                >
                  {hasScore ? `${Math.round((row.confidence as number) * 100)}` : "—"}
                </div>
                <div className="lowconf-body">
                  <p className="lowconf-q">
                    {row.question ?? <span className="muted">{t("lowconf.questionNotFound")}</span>}
                  </p>
                  <div className="lowconf-meta muted">
                    {row.insufficientKnowledge && <Badge tone="amber">{t("lowconf.insufficientBadge")}</Badge>}
                    <span>{row.reason ?? t("lowconf.noReason")}</span>
                    {row.model != null && <span className="mono">· {row.model}</span>}
                    <span className="mono">· {relativeTime(row.createdAt)}</span>
                  </div>
                </div>
                <Link
                  href="/knowledge-drafts"
                  className="btn btn-ghost btn-sm lowconf-action"
                >
                  {t("lowconf.draftKnowledge")}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function AdminHomePage() {
  const t = useT("dashboard");
  const { user, getIdToken } = useAuth();
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => rangeDays(range), [range]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setError(t("errorSignIn"));
        return;
      }
      const [revenue, funnel, validation, questions, pipeline, failedQueries, concierge] =
        await Promise.all([
          getRevenueReport(token, 3),
          getFunnelAnalytics(token, days),
          getValidationAnalytics(token, days),
          getQuestionsAnalytics(token, days),
          getKnowledgePipeline(token),
          getFailedQueries(token, { limit: LOWCONF_PREVIEW }),
          getConciergeAnalytics(token, days),
        ]);
      setData({ revenue, funnel, validation, questions, pipeline, failedQueries, concierge });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoad"));
    }
  }, [getIdToken, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = user?.displayName?.trim() || user?.email?.split("@")[0] || "there";
  const delta = data != null ? mrrDelta(data.revenue, t) : null;

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{t("eyebrow", { days })}</div>
          <h1 className="h1">{t("greetingLine", { greeting: greeting(t), name })}</h1>
          <p className="lede">{t("lede")}</p>
        </div>
        <div className="seg" role="group" aria-label={t("timeRange")}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={cx(range === r.id && "active")}
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {data != null && (
        <div className="kpi-grid">
          <Stat
            label={t("kpi.mrr")}
            value={usd(data.revenue.mrrCents)}
            delta={delta?.text}
            trend={delta?.trend}
          />
          <Stat
            label={t("kpi.activeSubscribers")}
            value={count(data.revenue.activeSubscriptions)}
            delta={t("kpi.livePlans", { count: count(data.revenue.byPlan.length) })}
          />
          <Stat
            label={t("kpi.consultConversions")}
            value={count(data.funnel.consultations)}
            delta={t("kpi.booked", { amount: usd(data.funnel.bookedRevenueCents) })}
            trend="up"
          />
          <Stat
            label={t("kpi.activationRate")}
            value={pct(data.validation.activation.activationRate)}
            delta={t("kpi.activationDelta", {
              activated: count(data.validation.activation.activatedUsers),
              total: count(data.validation.activation.newUsers),
            })}
          />
        </div>
      )}

      {data != null && <QuestionsCard data={data.questions} />}

      {data != null && <FunnelCard data={data.funnel} />}

      {data != null && <KnowledgePipelineCard data={data.pipeline} />}

      {data != null && <ConciergeSlaCard data={data.concierge} />}

      {data != null && <LowConfidenceCard rows={data.failedQueries} />}
    </AdminFrame>
  );
}
