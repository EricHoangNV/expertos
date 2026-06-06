import type { Messages } from "@expertos/ui";

/** M13.3: string extraction for the `funnel` admin page (consultation funnel). */
export const en = {
  // Page head + window selector.
  eyebrow: "M10.2 · Platform attribution",
  title: "Consultation funnel",
  window: "Window",
  windowOption: "Last {days} days",
  intro:
    "Platform-wide attribution from conversation to booked revenue. Consultation counts and revenue cover only consultations that arose from an in-chat recommendation.",
  // KPI stat cards.
  conversations: "Conversations · {days}d",
  recommendations: "Recommendations · {days}d",
  booked: "Booked · {days}d",
  consultations: "Consultations · {days}d",
  revenue: "Revenue · {days}d",
  // Stage attribution card (M19.4.2) — one bar row per funnel stage.
  stageAttribution: "Stage attribution",
  stageConversations: "Conversations",
  stageRecommendations: "Recommendations",
  stageBooked: "Booked",
  stageConsultations: "Consultations",
  stageRevenue: "Revenue",
  // Breakdown sections.
  byTrigger: "Recommendations by trigger",
  byResponse: "Recommendations by response",
  byStatus: "Consultations by status",
  // Table headers.
  colTrigger: "Trigger",
  colRecommendations: "Recommendations",
  // Auth + load errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load funnel analytics.",
} satisfies Messages;

export const vi = {
  eyebrow: "M10.2 · Phân bổ nền tảng",
  title: "Phễu tư vấn",
  window: "Khoảng thời gian",
  windowOption: "{days} ngày qua",
  intro:
    "Phân bổ toàn nền tảng từ cuộc trò chuyện đến doanh thu đã đặt. Số lượt tư vấn và doanh thu chỉ tính các buổi tư vấn phát sinh từ đề xuất trong cuộc trò chuyện.",
  conversations: "Cuộc trò chuyện · {days} ngày",
  recommendations: "Đề xuất · {days} ngày",
  booked: "Đã đặt · {days} ngày",
  consultations: "Buổi tư vấn · {days} ngày",
  revenue: "Doanh thu · {days} ngày",
  stageAttribution: "Phân bổ theo giai đoạn",
  stageConversations: "Cuộc trò chuyện",
  stageRecommendations: "Đề xuất",
  stageBooked: "Đã đặt",
  stageConsultations: "Buổi tư vấn",
  stageRevenue: "Doanh thu",
  byTrigger: "Đề xuất theo yếu tố kích hoạt",
  byResponse: "Đề xuất theo phản hồi",
  byStatus: "Buổi tư vấn theo trạng thái",
  colTrigger: "Yếu tố kích hoạt",
  colRecommendations: "Đề xuất",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải phân tích phễu.",
} satisfies Messages;
