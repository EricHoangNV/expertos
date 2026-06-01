"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Stat, Table, Field, Select } from "@expertos/ui";
import type { UsageAnalyticsDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getUsageAnalytics } from "../../src/lib/admin-client";

/** Trailing-window options the dashboard offers, in days. */
const DAY_OPTIONS = [7, 30, 90, 365] as const;

/** Format `cost_micros` (millionths of a USD cent) as a USD amount. */
function usdFromMicros(micros: number): string {
  return (micros / 1_000_000 / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** Format an integer with thousands separators. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

export default function AnalyticsPage() {
  const { getIdToken } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<UsageAnalyticsDto | null>(null);
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
      setReport(await getUsageAnalytics(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage analytics.");
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
          <h1 className="h1">Usage &amp; cost</h1>
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

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <div className="row gap1">
            <Stat label={`AI events · ${days}d`} value={count(report.totalEvents)} />
            <Stat label={`Active users · ${days}d`} value={count(report.activeUsers)} />
            <Stat label={`Prompt tokens · ${days}d`} value={count(report.promptTokens)} />
            <Stat label={`Completion tokens · ${days}d`} value={count(report.completionTokens)} />
            <Stat label={`AI cost · ${days}d`} value={usdFromMicros(report.totalCostMicros)} />
          </div>

          <h3 className="h3">By feature</h3>
          {report.byFeature.length === 0 ? (
            <p className="muted">No usage in this window.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Events</th>
                  <th>Prompt tokens</th>
                  <th>Completion tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.byFeature.map((row) => (
                  <tr key={row.featureKey}>
                    <td className="mono">{row.featureKey}</td>
                    <td>{count(row.events)}</td>
                    <td>{count(row.promptTokens)}</td>
                    <td>{count(row.completionTokens)}</td>
                    <td>{usdFromMicros(row.costMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <h3 className="h3">By model</h3>
          {report.byModel.length === 0 ? (
            <p className="muted">No usage in this window.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Events</th>
                  <th>Prompt tokens</th>
                  <th>Completion tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.byModel.map((row) => (
                  <tr key={row.model}>
                    <td className="mono">{row.model}</td>
                    <td>{count(row.events)}</td>
                    <td>{count(row.promptTokens)}</td>
                    <td>{count(row.completionTokens)}</td>
                    <td>{usdFromMicros(row.costMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <h3 className="h3">By day</h3>
          {report.periods.length === 0 ? (
            <p className="muted">No usage in this window.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Events</th>
                  <th>Active users</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.periods.map((period) => (
                  <tr key={period.period}>
                    <td className="mono">{period.period}</td>
                    <td>{count(period.events)}</td>
                    <td>{count(period.activeUsers)}</td>
                    <td>{usdFromMicros(period.costMicros)}</td>
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
