import type { Messages } from "@expertos/ui";

/** TODO(M13.3): string extraction for the `revenue` admin page. */
export const en = {
  // Page head + window selector.
  eyebrow: "Revenue",
  title: "Revenue report",
  window: "Window",
  windowOption: "Last {months} months",
  // KPI stat cards.
  mrr: "MRR",
  activeSubscribers: "Active subscribers",
  netRevenue: "Net revenue · {months}mo",
  aiCost: "AI cost · {months}mo",
  grossMargin: "Gross margin · {months}mo",
  // By-plan table.
  byPlan: "By plan",
  noSubscriptions: "No active subscriptions.",
  colPlan: "Plan",
  colActiveSubscribers: "Active subscribers",
  colMrr: "MRR",
  // By-month table.
  byMonth: "By month",
  noLedgerActivity: "No ledger activity in this window.",
  colMonth: "Month",
  colGross: "Gross",
  colRefunds: "Refunds",
  colNet: "Net",
  colTransactions: "Transactions",
  // Auth + load errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load revenue report.",
} satisfies Messages;

export const vi = {
  eyebrow: "Doanh thu",
  title: "Báo cáo doanh thu",
  window: "Khoảng thời gian",
  windowOption: "{months} tháng qua",
  mrr: "MRR",
  activeSubscribers: "Người đăng ký đang hoạt động",
  netRevenue: "Doanh thu ròng · {months} tháng",
  aiCost: "Chi phí AI · {months} tháng",
  grossMargin: "Biên lợi nhuận gộp · {months} tháng",
  byPlan: "Theo gói",
  noSubscriptions: "Không có đăng ký đang hoạt động.",
  colPlan: "Gói",
  colActiveSubscribers: "Người đăng ký đang hoạt động",
  colMrr: "MRR",
  byMonth: "Theo tháng",
  noLedgerActivity: "Không có hoạt động sổ cái trong khoảng này.",
  colMonth: "Tháng",
  colGross: "Tổng",
  colRefunds: "Hoàn tiền",
  colNet: "Ròng",
  colTransactions: "Giao dịch",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải báo cáo doanh thu.",
} satisfies Messages;
