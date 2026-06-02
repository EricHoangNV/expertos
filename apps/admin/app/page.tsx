"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Stat, cx } from "@expertos/ui";
import type {
  FunnelAnalyticsDto,
  RevenueReportDto,
  ValidationAnalyticsDto,
} from "@expertos/shared";
import { AdminFrame } from "../src/components/AdminFrame";
import { useAuth } from "../src/lib/auth-context";
import {
  getFunnelAnalytics,
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
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** A pre-computed fraction (`[0, 1]`) as a percentage. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
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
function mrrDelta(report: RevenueReportDto): { text: string; trend: "up" | "down" } | null {
  const periods = report.periods;
  if (periods.length < 2) return null;
  const latest = periods[periods.length - 1];
  const prior = periods[periods.length - 2];
  if (prior.netCents === 0) return null;
  const change = (latest.netCents - prior.netCents) / prior.netCents;
  const trend = change >= 0 ? "up" : "down";
  return { text: `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}% vs last mo`, trend };
}

interface DashboardData {
  revenue: RevenueReportDto;
  funnel: FunnelAnalyticsDto;
  validation: ValidationAnalyticsDto;
}

export default function AdminHomePage() {
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
        setError("Please sign in to continue.");
        return;
      }
      const [revenue, funnel, validation] = await Promise.all([
        getRevenueReport(token, 3),
        getFunnelAnalytics(token, days),
        getValidationAnalytics(token, days),
      ]);
      setData({ revenue, funnel, validation });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    }
  }, [getIdToken, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = user?.displayName?.trim() || user?.email?.split("@")[0] || "there";
  const delta = data != null ? mrrDelta(data.revenue) : null;

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Phase 1 · MVP · Last {days} days</div>
          <h1 className="h1">
            {greeting()}, {name}
          </h1>
          <p className="lede">
            Validating the loop: Expert → Knowledge → Voice → AI → Consultation.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Time range">
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
            label="MRR"
            value={usd(data.revenue.mrrCents)}
            delta={delta?.text}
            trend={delta?.trend}
          />
          <Stat
            label="Active subscribers"
            value={count(data.revenue.activeSubscriptions)}
            delta={`${count(data.revenue.byPlan.length)} live plans`}
          />
          <Stat
            label="Consult conversions"
            value={count(data.funnel.consultations)}
            delta={`${usd(data.funnel.bookedRevenueCents)} booked`}
            trend="up"
          />
          <Stat
            label="Activation rate"
            value={pct(data.validation.activation.activationRate)}
            delta={`${count(data.validation.activation.activatedUsers)} of ${count(
              data.validation.activation.newUsers,
            )} new users cited`}
          />
        </div>
      )}
    </AdminFrame>
  );
}
