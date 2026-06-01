import { z } from "zod";

/**
 * Revenue-report wire types (M8.3, PRD §"Admin" → "Revenue: transaction ledger + basic revenue
 * reports"). The admin revenue dashboard reads a single platform-wide report: current MRR + active
 * subscribers (from live `subscriptions` × `plan_prices`), a per-plan breakdown, a trailing monthly
 * series over the `transactions` ledger, and the AI `cost_micros` margin signal (M6.5) for the same
 * window. Read-only — the full reconciliation dashboard is Phase 2 (Stripe reconciles for MVP).
 *
 * All money is integer **cents**; AI cost stays in `cost_micros` (millionths of a USD cent, the
 * `usage_logs` unit) so it never loses precision crossing the wire — the dashboard converts.
 */

/**
 * Trailing-window query: how many whole calendar months (including the current one) the report
 * covers. The series + ledger totals are bounded by `date_trunc('month', now) - (months - 1)`.
 */
export const revenueReportQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});
export type RevenueReportQueryInput = z.infer<typeof revenueReportQuerySchema>;

/** One plan's live-subscription contribution to MRR (yearly prices normalized to a monthly amount). */
export interface RevenueByPlanDto {
  planKey: string;
  planName: string;
  /** Count of live (active/trialing) subscriptions on this plan. */
  activeSubscriptions: number;
  /** This plan's monthly-normalized recurring revenue, in cents. */
  mrrCents: number;
}

/** One calendar month of ledger activity (succeeded transactions only; refunds netted out). */
export interface RevenuePeriodDto {
  /** Month bucket, `YYYY-MM` (UTC). */
  period: string;
  /** Succeeded non-refund revenue booked in the month, in cents. */
  grossCents: number;
  /** Refunds booked in the month, in cents (positive). */
  refundedCents: number;
  /** `grossCents - refundedCents`. */
  netCents: number;
  /** Count of succeeded transactions in the month. */
  transactionCount: number;
}

/**
 * The admin revenue report (`GET /admin/revenue/report`). MRR + active subscribers are a point-in-time
 * snapshot; the window totals + series cover the trailing `windowMonths`. `marginCents` is the
 * realised gross margin for the window: `netCents - round(aiCostMicros / 1_000_000)`.
 */
export interface RevenueReportDto {
  /** Months covered by the window totals + series. */
  windowMonths: number;
  /** Start of the window (UTC ISO; first day of the earliest month covered). */
  since: string;
  /** Current monthly recurring revenue across all live subscriptions, in cents. */
  mrrCents: number;
  /** Count of live (active/trialing) subscriptions. */
  activeSubscriptions: number;
  /** Window gross (succeeded non-refund revenue), in cents. */
  grossCents: number;
  /** Window refunds, in cents (positive). */
  refundedCents: number;
  /** `grossCents - refundedCents` for the window. */
  netCents: number;
  /** Window AI spend, in `cost_micros` (millionths of a USD cent). */
  aiCostMicros: number;
  /** Realised gross margin for the window: `netCents - round(aiCostMicros / 1_000_000)`. */
  marginCents: number;
  /** Per-plan MRR + active-subscriber breakdown, highest plan tier first. */
  byPlan: RevenueByPlanDto[];
  /** Trailing monthly series (only months with ledger activity), oldest first. */
  periods: RevenuePeriodDto[];
}
