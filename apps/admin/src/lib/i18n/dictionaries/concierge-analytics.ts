import type { Messages } from "@expertos/ui";

/** M13.3: string extraction for the `concierge-analytics` admin page (concierge ops). */
export const en = {
  // Page head + window selector.
  eyebrow: "Analytics",
  title: "Concierge ops",
  window: "Window",
  windowOption: "Last {days} days",
  intro:
    "Platform-wide human-in-the-loop metrics. Request and verdict counts cover the window; the knowledge-quality flag counts are cumulative.",
  // KPI stat cards.
  requests: "Requests · {days}d",
  answered: "Answered · {days}d",
  answeredRate: "{rate} answered",
  slaMet: "SLA met",
  avgResponse: "Avg response",
  verdicts: "Verdicts · {days}d",
  // SLA section.
  slaAdherence: "SLA adherence",
  slaTracked: "Tracked: {count}",
  slaMetBadge: "Met: {count}",
  slaBreached: "Breached: {count}",
  slaOpenOverdue: "Open & overdue: {count}",
  // Trigger-mode labels (Mode A / Mode B language the concierge config uses).
  triggerModeUserPrompted: "User-prompted (Mode A)",
  triggerModeAutoSilent: "Auto-silent (Mode B)",
  triggerModeBadge: "{label}: {count}",
  // Breakdown sections.
  byStatus: "Requests by status",
  byTriggerModeVisibility: "By trigger mode & visibility",
  reviewerVerdicts: "Reviewer verdicts",
  // Status table headers.
  colStatus: "Status",
  colRequests: "Requests",
  // Verdict / visibility badges.
  verdictBadge: "{label}: {count}",
  visibilityBadge: "{label}: {count}",
  edited: "Edited: {count}",
  delivered: "Delivered: {count}",
  // Knowledge-quality section.
  knowledgeQuality: "Knowledge quality (cumulative)",
  flaggedChunks: "Flagged chunks",
  totalFlags: "Total flags",
  recentlyFlagged: "Flagged · {days}d",
  colFlaggedSourceChunk: "Flagged source chunk",
  colFlags: "Flags",
  colLastFlagged: "Last flagged",
  // Auth + load errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load concierge analytics.",
} satisfies Messages;

export const vi = {
  eyebrow: "Phân tích",
  title: "Vận hành concierge",
  window: "Khoảng thời gian",
  windowOption: "{days} ngày qua",
  intro:
    "Số liệu có con người tham gia trên toàn nền tảng. Số lượt yêu cầu và phán quyết tính trong khoảng thời gian; số liệu gắn cờ chất lượng tri thức là lũy kế.",
  requests: "Yêu cầu · {days} ngày",
  answered: "Đã trả lời · {days} ngày",
  answeredRate: "{rate} đã trả lời",
  slaMet: "Đạt SLA",
  avgResponse: "Thời gian phản hồi trung bình",
  verdicts: "Phán quyết · {days} ngày",
  slaAdherence: "Tuân thủ SLA",
  slaTracked: "Theo dõi: {count}",
  slaMetBadge: "Đạt: {count}",
  slaBreached: "Vi phạm: {count}",
  slaOpenOverdue: "Đang mở & quá hạn: {count}",
  triggerModeUserPrompted: "Người dùng yêu cầu (Chế độ A)",
  triggerModeAutoSilent: "Tự động ẩn (Chế độ B)",
  triggerModeBadge: "{label}: {count}",
  byStatus: "Yêu cầu theo trạng thái",
  byTriggerModeVisibility: "Theo chế độ kích hoạt & khả năng hiển thị",
  reviewerVerdicts: "Phán quyết của người duyệt",
  colStatus: "Trạng thái",
  colRequests: "Yêu cầu",
  verdictBadge: "{label}: {count}",
  visibilityBadge: "{label}: {count}",
  edited: "Đã chỉnh sửa: {count}",
  delivered: "Đã gửi: {count}",
  knowledgeQuality: "Chất lượng tri thức (lũy kế)",
  flaggedChunks: "Đoạn bị gắn cờ",
  totalFlags: "Tổng số lần gắn cờ",
  recentlyFlagged: "Gắn cờ · {days} ngày",
  colFlaggedSourceChunk: "Đoạn nguồn bị gắn cờ",
  colFlags: "Lần gắn cờ",
  colLastFlagged: "Lần gắn cờ gần nhất",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải phân tích concierge.",
} satisfies Messages;
