import type { Messages } from "@expertos/ui";

/** M13.3: string extraction for the `conversions` admin/expert page (expert conversions). */
export const en = {
  // Page head + expert selector.
  eyebrow: "Funnel",
  title: "Consultation conversions",
  expert: "Expert",
  selectExpertPlaceholder: "Select an expert…",
  intro:
    "Recommendations, bookings, and attributed revenue from conversations held in this expert’s voice.",
  selectExpertPrompt: "Select an expert to view their conversions.",
  noExpertProfile:
    "Your account isn’t linked to an expert profile yet, so there are no conversions to show.",
  // KPI stat cards.
  recommendations: "Recommendations",
  booked: "Booked",
  revenue: "Revenue",
  // Breakdown sections.
  byTrigger: "By trigger",
  byResponse: "By response",
  byStatus: "By consultation status",
  recentRecommendations: "Recent recommendations",
  noRecommendations: "No recommendations yet.",
  // Table headers.
  colTrigger: "Trigger",
  colRecommendations: "Recommendations",
  colWhen: "When",
  colResponse: "Response",
  colConsultation: "Consultation",
  colAmount: "Amount",
  // Auth + load errors.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load conversions.",
} satisfies Messages;

export const vi = {
  eyebrow: "Phễu",
  title: "Chuyển đổi tư vấn",
  expert: "Chuyên gia",
  selectExpertPlaceholder: "Chọn một chuyên gia…",
  intro:
    "Đề xuất, lượt đặt lịch và doanh thu được phân bổ từ các cuộc trò chuyện theo giọng nói của chuyên gia này.",
  selectExpertPrompt: "Chọn một chuyên gia để xem chuyển đổi của họ.",
  noExpertProfile:
    "Tài khoản của bạn chưa được liên kết với hồ sơ chuyên gia, nên chưa có chuyển đổi nào để hiển thị.",
  recommendations: "Đề xuất",
  booked: "Đã đặt",
  revenue: "Doanh thu",
  byTrigger: "Theo yếu tố kích hoạt",
  byResponse: "Theo phản hồi",
  byStatus: "Theo trạng thái tư vấn",
  recentRecommendations: "Đề xuất gần đây",
  noRecommendations: "Chưa có đề xuất nào.",
  colTrigger: "Yếu tố kích hoạt",
  colRecommendations: "Đề xuất",
  colWhen: "Thời điểm",
  colResponse: "Phản hồi",
  colConsultation: "Buổi tư vấn",
  colAmount: "Số tiền",
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải chuyển đổi.",
} satisfies Messages;
