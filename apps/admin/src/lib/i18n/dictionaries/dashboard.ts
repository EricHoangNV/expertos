import type { Messages } from "@expertos/ui";

/** TODO(M13.3): string extraction for the `dashboard` admin page. */
export const en = {
  // Page head: eyebrow, hour-keyed greeting, validation-loop lede, time-range control.
  eyebrow: "Last {days} days",
  greeting: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
  },
  greetingLine: "{greeting}, {name}",
  lede: "Validating the loop: Expert → Knowledge → Voice → AI → Consultation.",
  timeRange: "Time range",
  // KPI stat cards.
  kpi: {
    mrr: "MRR",
    mrrDelta: "{change}% vs last mo",
    activeSubscribers: "Active subscribers",
    livePlans: "{count} live plans",
    consultConversions: "Consult conversions",
    booked: "{amount} booked",
    activationRate: "Activation rate",
    activationDelta: "{activated} of {total} new users cited",
  },
  // Questions Answered card.
  questions: {
    title: "Questions answered",
    grounded: "Grounded · 2+ cites {share}",
    lowConf: "Low-conf · 1 cite {share}",
    insufficient: "Insufficient · 0 cites {share}",
    groundedLabel: "Grounded — 2+ resolved citations: {count}",
    lowConfLabel: "Low confidence — 1 resolved citation: {count}",
    insufficientLabel: "Insufficient — no resolved citations: {count}",
    colTitle: "{period}: {count} answered",
    note: "Grouped by resolved-citation count (2+ / 1 / 0). Reflects citation resolution, not factual review.",
    empty: "No answers in this window yet.",
  },
  // Consultation Funnel card.
  funnel: {
    title: "Consultation funnel · attribution",
    questions: "Questions",
    recommend: "Recommend",
    booked: "Booked",
    revenue: "Revenue",
    rowAria: "{label}: {value}",
    summary: "{rate} recommend→book. Each booking averages {avg}.",
  },
  // Knowledge Pipeline card.
  pipeline: {
    title: "Knowledge pipeline",
    reviewQueue: "Review queue →",
    draft: "Draft",
    expertReview: "Expert Review",
    published: "Published",
  },
  // Concierge SLA card.
  sla: {
    title: "Concierge SLA",
    inQueue: "{count} in queue",
    sub: "avg time-to-answer · target 24h",
    openQueue: "Open queue →",
  },
  // Low-Confidence & Failed Queries card.
  lowconf: {
    eyebrow: "Inspect · low-confidence & failed queries",
    title: "Drives the content roadmap",
    openPipeline: "Open pipeline →",
    empty: "No flagged answers yet — nothing to triage.",
    confidenceTitle: "confidence {score}",
    noScore: "no score",
    questionNotFound: "— (question not found)",
    insufficientBadge: "Insufficient",
    noReason: "no reason given",
    draftKnowledge: "Draft knowledge",
  },
  // Auth + load errors surfaced on the page.
  errorSignIn: "Please sign in to continue.",
  errorLoad: "Failed to load dashboard.",
} satisfies Messages;

export const vi = {
  eyebrow: "{days} ngày qua",
  greeting: {
    morning: "Chào buổi sáng",
    afternoon: "Chào buổi chiều",
    evening: "Chào buổi tối",
  },
  greetingLine: "{greeting}, {name}",
  lede: "Kiểm chứng vòng lặp: Chuyên gia → Kiến thức → Giọng văn → AI → Tư vấn.",
  timeRange: "Khoảng thời gian",
  kpi: {
    mrr: "MRR",
    mrrDelta: "{change}% so với tháng trước",
    activeSubscribers: "Người đăng ký đang hoạt động",
    livePlans: "{count} gói đang hoạt động",
    consultConversions: "Chuyển đổi tư vấn",
    booked: "{amount} đã đặt",
    activationRate: "Tỷ lệ kích hoạt",
    activationDelta: "{activated} trên {total} người dùng mới đã trích dẫn",
  },
  questions: {
    title: "Câu hỏi đã trả lời",
    grounded: "Có dẫn nguồn · 2+ trích dẫn {share}",
    lowConf: "Tin cậy thấp · 1 trích dẫn {share}",
    insufficient: "Thiếu căn cứ · 0 trích dẫn {share}",
    groundedLabel: "Có dẫn nguồn — 2+ trích dẫn đã phân giải: {count}",
    lowConfLabel: "Độ tin cậy thấp — 1 trích dẫn đã phân giải: {count}",
    insufficientLabel: "Thiếu căn cứ — không có trích dẫn phân giải: {count}",
    colTitle: "{period}: {count} đã trả lời",
    note: "Phân nhóm theo số trích dẫn đã phân giải (2+ / 1 / 0). Phản ánh việc phân giải trích dẫn, không phải kiểm chứng nội dung.",
    empty: "Chưa có câu trả lời nào trong khoảng này.",
  },
  funnel: {
    title: "Phễu tư vấn · phân bổ",
    questions: "Câu hỏi",
    recommend: "Đề xuất",
    booked: "Đã đặt",
    revenue: "Doanh thu",
    rowAria: "{label}: {value}",
    summary: "{rate} đề xuất→đặt lịch. Mỗi lượt đặt trung bình {avg}.",
  },
  pipeline: {
    title: "Quy trình kiến thức",
    reviewQueue: "Hàng đợi duyệt →",
    draft: "Bản nháp",
    expertReview: "Chuyên gia duyệt",
    published: "Đã xuất bản",
  },
  sla: {
    title: "SLA hỗ trợ",
    inQueue: "{count} trong hàng đợi",
    sub: "thời gian trả lời trung bình · mục tiêu 24 giờ",
    openQueue: "Mở hàng đợi →",
  },
  lowconf: {
    eyebrow: "Kiểm tra · truy vấn tin cậy thấp & thất bại",
    title: "Định hướng lộ trình nội dung",
    openPipeline: "Mở quy trình →",
    empty: "Chưa có câu trả lời bị gắn cờ — không có gì để xử lý.",
    confidenceTitle: "độ tin cậy {score}",
    noScore: "không có điểm",
    questionNotFound: "— (không tìm thấy câu hỏi)",
    insufficientBadge: "Thiếu căn cứ",
    noReason: "không nêu lý do",
    draftKnowledge: "Soạn kiến thức",
  },
  errorSignIn: "Vui lòng đăng nhập để tiếp tục.",
  errorLoad: "Không thể tải bảng điều khiển.",
} satisfies Messages;
