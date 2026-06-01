"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Stat, Table, Field, Select } from "@expertos/ui";
import type { RevenueReportDto } from "@expertos/shared";
import { AdminFrame } from "../../src/components/AdminFrame";
import { useAuth } from "../../src/lib/auth-context";
import { getRevenueReport } from "../../src/lib/admin-client";

/** Trailing-window options the dashboard offers. */
const MONTH_OPTIONS = [3, 6, 12, 24] as const;

/** Format integer cents as a USD amount. */
function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Format `cost_micros` (millionths of a USD cent) as a USD amount. */
function usdFromMicros(micros: number): string {
  return usd(Math.round(micros / 1_000_000));
}

export default function RevenuePage() {
  const { getIdToken } = useAuth();
  const [months, setMonths] = useState<number>(12);
  const [report, setReport] = useState<RevenueReportDto | null>(null);
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
      setReport(await getRevenueReport(token, months));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revenue report.");
    }
  }, [getIdToken, months]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminFrame>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Revenue</div>
          <h1 className="h1">Revenue report</h1>
        </div>
        <Field label="Window">
          <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error != null && <Badge tone="red">{error}</Badge>}

      {report != null && (
        <>
          <div className="row gap1">
            <Stat label="MRR" value={usd(report.mrrCents)} />
            <Stat label="Active subscribers" value={report.activeSubscriptions} />
            <Stat label={`Net revenue · ${months}mo`} value={usd(report.netCents)} />
            <Stat label={`AI cost · ${months}mo`} value={usdFromMicros(report.aiCostMicros)} />
            <Stat
              label={`Gross margin · ${months}mo`}
              value={usd(report.marginCents)}
              trend={report.marginCents >= 0 ? "up" : "down"}
            />
          </div>

          <h3 className="h3">By plan</h3>
          {report.byPlan.length === 0 ? (
            <p className="muted">No active subscriptions.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Active subscribers</th>
                  <th>MRR</th>
                </tr>
              </thead>
              <tbody>
                {report.byPlan.map((plan) => (
                  <tr key={plan.planKey}>
                    <td>{plan.planName}</td>
                    <td>{plan.activeSubscriptions}</td>
                    <td>{usd(plan.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <h3 className="h3">By month</h3>
          {report.periods.length === 0 ? (
            <p className="muted">No ledger activity in this window.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Gross</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Transactions</th>
                </tr>
              </thead>
              <tbody>
                {report.periods.map((period) => (
                  <tr key={period.period}>
                    <td className="mono">{period.period}</td>
                    <td>{usd(period.grossCents)}</td>
                    <td>{usd(period.refundedCents)}</td>
                    <td>{usd(period.netCents)}</td>
                    <td>{period.transactionCount}</td>
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
