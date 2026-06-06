import type { Messages } from "@expertos/ui";

/** M13.3: string extraction for the `analytics` admin page (usage & cost). */
export const en = {
  // Page head + window selector.
  eyebrow: "AI cost & token usage",
  title: "Usage analytics",
  window: "Window",
  windowOption: "Last {days} days",
  // KPI stat cards.
  aiEvents: "AI events · {days}d",
  activeUsers: "Active users · {days}d",
  promptTokens: "Prompt tokens · {days}d",
  completionTokens: "Completion tokens · {days}d",
  aiCost: "AI cost · {days}d",
  // Breakdown sections.
  byFeature: "By feature",
  byModel: "By model",
  byDay: "By day",
  noUsage: "No usage in this window.",
  // Table headers.
  colFeature: "Feature",
  colModel: "Model",
  colDay: "Day",
  colEvents: "Events",
  colPromptTokens: "Prompt tokens",
  colCompletionTokens: "Completion tokens",
  colCost: "Cost",
  colActiveUsers: "Active users",
  // Auth + load errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load usage analytics.",
} satisfies Messages;

export const vi = {
  eyebrow: "Chi phí AI & sử dụng token",
  title: "Phân tích sử dụng",
  window: "Khoảng thời gian",
  windowOption: "{days} ngày qua",
  aiEvents: "Sự kiện AI · {days} ngày",
  activeUsers: "Người dùng hoạt động · {days} ngày",
  promptTokens: "Token đầu vào · {days} ngày",
  completionTokens: "Token đầu ra · {days} ngày",
  aiCost: "Chi phí AI · {days} ngày",
  byFeature: "Theo tính năng",
  byModel: "Theo mô hình",
  byDay: "Theo ngày",
  noUsage: "Không có mức sử dụng trong khoảng này.",
  colFeature: "Tính năng",
  colModel: "Mô hình",
  colDay: "Ngày",
  colEvents: "Sự kiện",
  colPromptTokens: "Token đầu vào",
  colCompletionTokens: "Token đầu ra",
  colCost: "Chi phí",
  colActiveUsers: "Người dùng hoạt động",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải phân tích mức sử dụng.",
} satisfies Messages;
